import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { CommunitySite } from '../../../testing/community-site';

// 커뮤니티 회원 (스토어 3-1a, 아이디 · 비밀번호 가입, docs/스토어.md 11장): 앱 도메인에서만 열리는 회원 API, 가입 → 회원 쿠키 → 로그인,
// 해킹 대비(실패 문구 하나 · 틀린 시도 제한 · 가입 제한 · 새 세션 · 비밀번호를 바꾸면 다른 로그인 끝남), 쓰기의 출처 · CSRF 확인,
// 원칙 10(회원은 관리자가 아니다 · 관리자 로그인은 회원이 아니다).
// 도메인은 모든 공간에서 하나이고 테스트 DB를 함께 쓰므로 이 실행의 표시를 붙인다. 시도 제한은 앱 · 곳(IP)마다 센다:
// 테스트는 모두 127.0.0.1(앞단 프록시로 믿는 곳)에서 오므로 가입마다 X-Forwarded-For로 다른 곳을 싣는다

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
const mark = randomUUID().slice(0, 8);
const HOST = `town-${mark}.example.com`;
const OTHER = `club-${mark}.example.com`;
const ORIGIN = `http://${HOST}`;
const PASSWORD = '오늘은 비가 와서 집에 있다';
let appId = '';
let appVersion = 0;
let hostSeq = 0;
let ipSeq = 0;

/** 가입마다 다른 곳 (가입 제한이 곳마다라서) */
function nextIp(): string {
  ipSeq += 1;
  return `10.20.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
}

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function newApp(kind: string, slug: string, domain: string, open = true): Promise<Json> {
  const made = ok(
    await api.request('POST', '/api/apps', owner, {
      requestId: randomUUID(),
      kind,
      name: `앱 ${slug}`,
      slug,
    }),
    201,
  );
  return CommunitySite.link(api, owner, made, domain, open);
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

/** 새 커뮤니티 앱의 도메인 (가입 제한이 앱 · 곳마다라 가입을 많이 하는 테스트는 앱을 나눈다) */
async function freshHost(): Promise<string> {
  hostSeq += 1;
  const host = `c${hostSeq}-${mark}.example.com`;
  await newApp('community', `c${hostSeq}-${mark}`, host);
  return host;
}

function join(body: Json, host = HOST, ip = nextIp()): Promise<ApiResult> {
  return at(
    '/api/community/join',
    { method: 'POST', body: { ageConfirmed: true, ...body }, headers: { 'x-forwarded-for': ip } },
    host,
  );
}

/** 가입까지 마친 회원의 브라우저 */
async function member(loginId: string, nickname: string, host = HOST): Promise<TestUser> {
  const res = await join({ loginId, password: PASSWORD, nickname }, host);
  assert.equal(res.status, 201, res.text);
  return new TestUser(res.cookies());
}

/** 이 브라우저의 쓰기 확인 값 */
async function csrfOf(browser: TestUser, host = HOST): Promise<string> {
  return String(ok(await at('/api/community/me', { as: browser }, host)).csrf);
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  const town = await newApp('community', `town-${mark}`, HOST);
  appId = String(town.id);
  appVersion = Number(town.version);
  await newApp('community', `club-${mark}`, OTHER);
});
after(async () => {
  await api.close();
});

describe('어디서 열리는가', () => {
  test('기본 도메인에서는 없는 주소 (콘솔과 같은 출처에 회원 쿠키를 두지 않는다)', async () => {
    assert.equal((await api.get('/api/community/me')).status, 404);
    const res = await api.request('POST', '/api/community/join', TestUser.visitor, {
      loginId: 'mainsite',
      password: PASSWORD,
      nickname: '기본도메인',
      ageConfirmed: true,
    });
    assert.equal(res.status, 404);
  });

  test('공개된 커뮤니티 앱의 도메인에서만: 블로그 앱 · 비공개 커뮤니티 앱의 도메인은 404', async () => {
    await newApp('blog', `blog-${mark}`, `blog-${mark}.example.com`);
    await newApp('community', `shut-${mark}`, `shut-${mark}.example.com`, false);
    assert.equal((await at('/api/community/me', {}, `blog-${mark}.example.com`)).status, 404);
    assert.equal((await at('/api/community/me', {}, `shut-${mark}.example.com`)).status, 404);
    assert.deepEqual(ok(await at('/api/community/me')), { member: null, csrf: null });
  });

  test('관리자 경로(/api/community/admin)와 다른 관리 API는 앱 도메인에서 404', async () => {
    assert.equal((await at('/api/community/admin/x')).status, 404);
    assert.equal((await at('/api/agents', { as: owner })).status, 404);
  });
});

describe('가입과 로그인', () => {
  test('가입하면 바로 로그인된다: 회원 쿠키 · 자기 정보 · 쓰기 확인 값 (비밀번호 해시는 어디에도 없다)', async () => {
    const res = await join({ loginId: '  Villager ', password: PASSWORD, nickname: '마을사람' });
    const self = ok(res, 201);
    assert.equal(self.loginId, 'villager');
    assert.ok(res.cookies().cairn_member);
    assert.doesNotMatch(res.text, /scrypt/);
    const me = ok(await at('/api/community/me', { as: new TestUser(res.cookies()) }));
    assert.equal((me.member as Json).nickname, '마을사람');
    assert.equal(typeof me.csrf, 'string');
  });

  test('규칙: 만 14세 확인 · 아이디 모양 · 운영자로 보이는 이름 · 쉬운 비밀번호는 422, 겹치면 409', async () => {
    const host = await freshHost();
    const try1 = (body: Json) =>
      join({ loginId: 'rules_one', password: PASSWORD, nickname: '규칙', ...body }, host);
    assert.match((await try1({ ageConfirmed: false })).text, /만 14세/);
    assert.match((await try1({ loginId: '1abc' })).text, /영문 소문자로 시작/);
    assert.match((await try1({ loginId: 'admin_kim' })).text, /운영자로 보이는 아이디/);
    assert.equal((await try1({ password: 'short' })).status, 422);
    assert.match((await try1({ password: '1234567890' })).text, /너무 쉬운/);
    assert.equal((await try1({})).status, 201);
    const again = await join(
      { loginId: 'RULES_ONE', password: PASSWORD, nickname: '다른이름' },
      host,
    );
    assert.match(again.text, /이미 쓰는 아이디/);
    assert.equal(again.status, 409);
  });

  test('로그인: 맞으면 새 세션, 틀린 비밀번호와 없는 아이디는 같은 문구', async () => {
    await member('login_ok', '로그인됨');
    const login = (loginId: string, password: string) =>
      at('/api/community/login', { method: 'POST', body: { loginId, password } });
    const res = await login('LOGIN_OK', PASSWORD);
    const self = ok(res);
    assert.equal(self.loginId, 'login_ok');
    assert.ok(res.cookies().cairn_member);
    const wrong = await login('login_ok', '틀린 비밀번호입니다');
    const missing = await login('nobody_here', PASSWORD);
    assert.equal(wrong.status, 401);
    assert.equal(missing.status, 401);
    assert.equal(wrong.json().message, missing.json().message);
  });

  test('틀린 로그인은 아이디마다 15분에 5번까지, 넘으면 맞는 비밀번호도 429', async () => {
    const host = await freshHost();
    await member('locked_one', '잠길사람', host);
    const login = (password: string) =>
      at(
        '/api/community/login',
        { method: 'POST', body: { loginId: 'locked_one', password } },
        host,
      );
    for (let i = 0; i < 5; i += 1)
      assert.equal((await login(`틀린 비밀번호 ${i}번째`)).status, 401);
    assert.equal((await login(PASSWORD)).status, 429);
  });

  test('가입은 한 곳에서 1시간에 3번까지 (겹친 아이디로 찔러보는 것도 센다)', async () => {
    const host = await freshHost();
    const ip = '10.99.0.1';
    const signUp = (loginId: string, nickname: string, from = ip) =>
      join({ loginId, password: PASSWORD, nickname }, host, from);
    assert.equal((await signUp('spam_one', 'spam_one')).status, 201);
    assert.equal((await signUp('spam_two', 'spam_two')).status, 201);
    assert.equal((await signUp('spam_one', '찔러보기')).status, 409);
    assert.equal((await signUp('spam_four', 'spam_four')).status, 429);
    assert.equal(
      (await signUp('spam_four', 'spam_four', nextIp())).status,
      201,
      '다른 곳은 그대로',
    );
  });
});

describe('회원 정보 · 비밀번호 · 로그아웃', () => {
  test('닉네임 바꾸기: 버전이 맞아야 하고 7일에 한 번', async () => {
    const me = await member('rename_me', '바꿀사람');
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

  test('비밀번호 바꾸기: 지금 비밀번호가 맞아야 하고, 이 브라우저 말고 다른 로그인은 끝난다', async () => {
    const first = await member('change_pw', '바꾸는사람');
    const second = new TestUser(
      (
        await at('/api/community/login', {
          method: 'POST',
          body: { loginId: 'change_pw', password: PASSWORD },
        })
      ).cookies(),
    );
    const csrf = await csrfOf(first);
    const change = (current: string, next: string) =>
      at('/api/community/me/password', {
        method: 'PATCH',
        as: first,
        body: { current, next },
        headers: { 'x-cairn-csrf': csrf },
      });
    assert.match(
      (await change('틀린 지금 비밀번호', '새로운 긴 비밀번호입니다')).text,
      /지금 비밀번호/,
    );
    assert.equal((await change(PASSWORD, 'change_pw')).status, 422);
    assert.equal((await change(PASSWORD, '새로운 긴 비밀번호입니다')).status, 204);
    assert.notEqual(ok(await at('/api/community/me', { as: first })).member, null);
    assert.equal(ok(await at('/api/community/me', { as: second })).member, null);
    const old = await at('/api/community/login', {
      method: 'POST',
      body: { loginId: 'change_pw', password: PASSWORD },
    });
    assert.equal(old.status, 401);
  });

  test('로그아웃하면 그 쿠키는 더 회원이 아니다', async () => {
    const me = await member('logout_me', '나갈사람');
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
    const me = await member('careful_one', '조심하는');
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

  test('다른 사이트가 남의 브라우저로 로그인 · 가입을 보내면 403 (쿠키가 없어도)', async () => {
    const res = await api.viaHost('/api/community/login', HOST, {
      method: 'POST',
      body: { loginId: 'careful_one', password: PASSWORD },
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(res.status, 403);
  });
});

describe('회원은 관리자가 아니다 (원칙 10)', () => {
  test('회원 쿠키는 기본 도메인에서 방문자, 다른 앱의 도메인에서 회원이 아니다', async () => {
    const me = await member('watcher_one', '구경꾼');
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
