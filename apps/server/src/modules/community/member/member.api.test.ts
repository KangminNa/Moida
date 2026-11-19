import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';

// 커뮤니티 회원 (스토어 3-1a, docs/스토어.md 11장): 앱 도메인에서만 열리는 회원 API, 카카오 로그인(테스트용 카카오 서버) →
// 가입 표 → 가입 → 회원 쿠키, 쓰기의 출처 · CSRF 확인, 원칙 10(회원은 관리자가 아니다 · 관리자 로그인은 회원이 아니다).
// 도메인은 모든 공간에서 하나이고 테스트 DB를 함께 쓰므로 이 실행의 표시를 붙인다.

type Json = Record<string, unknown>;

/** 플러그인 폴더의 테스트용 카카오 서버 (플러그인 단위 테스트와 같은 것을 쓴다) */
interface FakeKakao {
  readonly url: string;
  close(): Promise<void>;
}

let api: ApiClient;
let owner: TestUser;
let kakao: FakeKakao;
const mark = randomUUID().slice(0, 8);
const HOST = `town-${mark}.example.com`;
const OTHER = `club-${mark}.example.com`;
const ORIGIN = `http://${HOST}`;
let appId = '';
let appVersion = 0;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function newApp(
  kind: string,
  slug: string,
  domain: string | null,
  open = true,
): Promise<Json> {
  const made = ok(
    await api.request('POST', '/api/apps', owner, {
      requestId: randomUUID(),
      kind,
      name: `앱 ${slug}`,
      slug,
    }),
    201,
  );
  const body: Json = { version: made.version, domain };
  if (open) body.visibility = 'public';
  return ok(await api.request('PATCH', `/api/apps/${made.id}`, owner, body));
}

/** 앱 도메인으로 보내는 요청. 쓰기는 이 도메인의 화면에서 보낸 것처럼 Origin을 붙인다 */
function at(
  path: string,
  options: { method?: string; as?: TestUser; body?: object; headers?: Record<string, string> } = {},
  host = HOST,
): Promise<ApiResult> {
  const write = (options.method ?? 'GET') !== 'GET';
  return api.viaHost(path, host, {
    ...options,
    headers: { ...(write ? { origin: `http://${host}` } : {}), ...options.headers },
  });
}

/** 카카오 로그인 한 바퀴: 시작 → 테스트용 카카오 코드 → 돌아오기. 돌아온 응답(302)과 그동안의 쿠키 */
async function signIn(kakaoId: number, back = '/p/1', host = HOST): Promise<[ApiResult, TestUser]> {
  const begin = await at(
    `/api/community/login/kakao/start?return=${encodeURIComponent(back)}`,
    {},
    host,
  );
  assert.equal(begin.status, 302, begin.text);
  const state = new URL(begin.location ?? '').searchParams.get('state') ?? '';
  const browser = new TestUser(begin.cookies());
  const done = await at(
    `/api/community/login/kakao/callback?code=ok-${kakaoId}&state=${encodeURIComponent(state)}`,
    { as: browser },
    host,
  );
  return [done, browser.with(done.cookies())];
}

/** 이 브라우저의 쓰기 확인 값 */
async function csrfOf(browser: TestUser, host = HOST): Promise<string> {
  return String(ok(await at('/api/community/me', { as: browser }, host)).csrf);
}

/** 가입까지 마친 회원의 브라우저 */
async function member(kakaoId: number, nickname: string): Promise<TestUser> {
  const [, joining] = await signIn(kakaoId);
  const csrf = await csrfOf(joining);
  const joined = await at('/api/community/join', {
    method: 'POST',
    as: joining,
    body: { nickname, ageConfirmed: true },
    headers: { 'x-cairn-csrf': csrf },
  });
  assert.equal(joined.status, 201, joined.text);
  return joining.with(joined.cookies());
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  const entry = resolve(process.cwd(), '../../plugins/login-kakao/server/fake-kakao');
  const loaded = require(entry) as { FakeKakao: { start(): Promise<FakeKakao> } };
  kakao = await loaded.FakeKakao.start();
  assert.equal((await api.request('POST', '/api/plugins/login-kakao/enable', owner)).status, 200);
  const saved = await api.request('PUT', '/api/plugins/login-kakao/settings', owner, {
    values: { restApiKey: 'rest-key-1', authUrl: kakao.url, apiUrl: kakao.url },
  });
  assert.equal(saved.status, 200, saved.text);
  const town = await newApp('community', `town-${mark}`, HOST);
  appId = String(town.id);
  appVersion = Number(town.version);
  await newApp('community', `club-${mark}`, OTHER);
});
after(async () => {
  await api.request('POST', '/api/plugins/login-kakao/disable', owner);
  await api.close();
  await kakao.close();
});

describe('어디서 열리는가', () => {
  test('기본 도메인에서는 없는 주소 (콘솔과 같은 출처에 회원 쿠키를 두지 않는다)', async () => {
    assert.equal((await api.get('/api/community/me')).status, 404);
    assert.equal((await api.get('/api/community/login/kakao/start')).status, 404);
  });

  test('공개된 커뮤니티 앱의 도메인에서만: 블로그 앱 · 비공개 커뮤니티 앱의 도메인은 404', async () => {
    await newApp('blog', `blog-${mark}`, `blog-${mark}.example.com`);
    await newApp('community', `shut-${mark}`, `shut-${mark}.example.com`, false);
    assert.equal((await at('/api/community/me', {}, `blog-${mark}.example.com`)).status, 404);
    assert.equal((await at('/api/community/me', {}, `shut-${mark}.example.com`)).status, 404);
    assert.deepEqual(ok(await at('/api/community/me')), {
      member: null,
      joining: false,
      csrf: null,
    });
  });

  test('관리자 경로(/api/community/admin)와 다른 관리 API는 앱 도메인에서 404', async () => {
    assert.equal((await at('/api/community/admin/x')).status, 404);
    assert.equal((await at('/api/agents', { as: owner })).status, 404);
  });

  test('회원 로그인 버튼은 회원용 로그인 플러그인만 (카카오)', async () => {
    assert.deepEqual(ok(await at('/api/community/login/methods')), {
      methods: [{ method: 'kakao', label: '카카오로 로그인' }],
    });
    assert.equal((await at('/api/community/login/github/start')).status, 404);
  });
});

describe('로그인과 가입', () => {
  test('시작: 카카오로 보내고 돌아올 주소는 이 앱 도메인', async () => {
    const begin = await at('/api/community/login/kakao/start?return=%2Fp%2F1');
    const url = new URL(begin.location ?? '');
    assert.equal(`${url.origin}${url.pathname}`, `${kakao.url}/oauth/authorize`);
    assert.equal(
      url.searchParams.get('redirect_uri'),
      `${ORIGIN}/api/community/login/kakao/callback`,
    );
    assert.ok(begin.cookies().cairn_member_login);
    assert.equal((await at('/api/community/login/kakao/start?return=//evil.com')).status, 400);
  });

  test('처음 온 계정은 가입 표를 받아 가입 화면으로, 가입하면 회원 쿠키', async () => {
    const [done, joining] = await signIn(9001, '/p/7');
    assert.equal(done.status, 302);
    assert.equal(done.location, '/_/join?return=%2Fp%2F7');
    assert.ok(done.cookies().cairn_member_join);
    assert.equal(done.cookies().cairn_member, undefined);
    const me = ok(await at('/api/community/me', { as: joining }));
    assert.equal(me.joining, true);
    assert.equal(typeof me.csrf, 'string');

    const join = (body: object, csrf = String(me.csrf)) =>
      at('/api/community/join', {
        method: 'POST',
        as: joining,
        body,
        headers: { 'x-cairn-csrf': csrf },
      });
    assert.equal((await join({ nickname: '마을사람', ageConfirmed: true }, 'wrong')).status, 403);
    assert.match((await join({ nickname: '마을사람', ageConfirmed: false })).text, /만 14세/);
    assert.match(
      (await join({ nickname: '운영자김', ageConfirmed: true })).text,
      /운영자로 보이는/,
    );
    const joined = await join({ nickname: '마을사람', ageConfirmed: true });
    assert.equal(joined.status, 201, joined.text);
    assert.equal(joined.json().nickname, '마을사람');
    assert.ok(joined.cookies().cairn_member);
    assert.equal(joined.cookies().cairn_member_join, '');

    const signed = joining.with(joined.cookies());
    const after = ok(await at('/api/community/me', { as: signed }));
    assert.equal((after.member as Json).nickname, '마을사람');
    assert.equal(after.joining, false);
  });

  test('가입한 계정으로 다시 로그인하면 돌아갈 곳으로 바로', async () => {
    await member(9002, '두번째');
    const [done] = await signIn(9002, '/p/9');
    assert.equal(done.location, '/p/9');
    assert.ok(done.cookies().cairn_member);
  });

  test('같은 닉네임(대소문자 · 공백 무시)은 409, 가입 표 없이 가입은 401', async () => {
    await member(9003, 'Kim Lee');
    const [, joining] = await signIn(9004);
    const csrf = await csrfOf(joining);
    const res = await at('/api/community/join', {
      method: 'POST',
      as: joining,
      body: { nickname: 'kim.lee', ageConfirmed: true },
      headers: { 'x-cairn-csrf': csrf },
    });
    assert.equal(res.status, 409, res.text);
    const bare = await at('/api/community/join', {
      method: 'POST',
      body: { nickname: '아무개', ageConfirmed: true },
    });
    assert.equal(bare.status, 401, bare.text);
  });

  test('시작하지 않은 브라우저 · 틀린 코드는 로그인 화면으로 (?error=)', async () => {
    const forged = await at('/api/community/login/kakao/callback?code=ok-1&state=nope');
    assert.equal(forged.status, 302);
    assert.match(forged.location ?? '', /^\/_\/login\?error=/);
    const begin = await at('/api/community/login/kakao/start');
    const state = new URL(begin.location ?? '').searchParams.get('state') ?? '';
    const bad = await at(`/api/community/login/kakao/callback?code=bad&state=${state}`, {
      as: new TestUser(begin.cookies()),
    });
    assert.match(bad.location ?? '', /^\/_\/login\?error=/);
  });
});

describe('회원 정보와 로그아웃', () => {
  test('닉네임 바꾸기: 버전이 맞아야 하고 7일에 한 번', async () => {
    const me = await member(9101, '바꿀사람');
    const csrf = await csrfOf(me);
    const self = ok(await at('/api/community/me', { as: me })).member as Json;
    const rename = (nickname: string, version: unknown) =>
      at('/api/community/me', {
        method: 'PATCH',
        as: me,
        body: { nickname, version },
        headers: { 'x-cairn-csrf': csrf },
      });
    const renamed = ok(await rename('바꾼사람', self.version));
    assert.equal(renamed.nickname, '바꾼사람');
    assert.equal((await rename('또바꿈', self.version)).status, 409);
    assert.match((await rename('또바꿈', renamed.version)).text, /7일에 한 번/);
  });

  test('로그아웃하면 그 쿠키는 더 회원이 아니다', async () => {
    const me = await member(9102, '나갈사람');
    const csrf = await csrfOf(me);
    const out = await at('/api/community/logout', {
      method: 'POST',
      as: me,
      headers: { 'x-cairn-csrf': csrf },
    });
    assert.equal(out.status, 204, out.text);
    assert.equal(ok(await at('/api/community/me', { as: me })).member, null);
  });
});

describe('쓰기 확인 (11.1 세션 탈취 · CSRF)', () => {
  test('다른 사이트에서 온 쓰기 · 다른 출처 · 확인 값 없는 쓰기는 403', async () => {
    const me = await member(9201, '조심하는');
    const csrf = await csrfOf(me);
    const body = { nickname: '바뀌면안됨', version: 1 };
    const patch = (headers: Record<string, string>) =>
      api.viaHost('/api/community/me', HOST, { method: 'PATCH', as: me, body, headers });
    assert.equal(
      (await patch({ 'sec-fetch-site': 'cross-site', 'x-cairn-csrf': csrf })).status,
      403,
    );
    assert.equal(
      (await patch({ origin: 'https://evil.example', 'x-cairn-csrf': csrf })).status,
      403,
    );
    assert.equal((await patch({ origin: ORIGIN })).status, 403);
  });
});

describe('회원은 관리자가 아니다 (원칙 10)', () => {
  test('회원 쿠키는 기본 도메인에서 방문자, 다른 앱의 도메인에서 회원이 아니다', async () => {
    const me = await member(9301, '구경꾼');
    assert.equal((await api.get('/api/auth/me', me)).status, 401);
    assert.equal((await api.get('/api/agents', me)).status, 403);
    assert.equal(ok(await at('/api/community/me', { as: me }, OTHER)).member, null);
  });

  test('관리자 로그인 쿠키는 앱 도메인에서 회원이 아니다', async () => {
    assert.equal(ok(await at('/api/community/me', { as: owner })).member, null);
  });
});

describe('커뮤니티 앱 (blog의 앱 종류)', () => {
  test('메뉴를 둘 수 없고, 블로그 글을 넣을 수 없고, 지울 수 없다', async () => {
    const made = await api.request('POST', '/api/apps', owner, {
      requestId: randomUUID(),
      kind: 'community',
      name: '메뉴 있는 커뮤니티',
      slug: `menu-${mark}`,
      menus: ['공지'],
    });
    assert.equal(made.status, 422, made.text);
    const post = await api.request('POST', '/api/posts', owner, {
      requestId: randomUUID(),
      title: '커뮤니티에 넣을 글',
      body: '본문',
      appId,
    });
    assert.equal(post.status, 422, post.text);
    const removed = await api.request('POST', `/api/apps/${appId}/delete`, owner, {
      version: appVersion,
    });
    assert.equal(removed.status, 422, removed.text);
  });
});
