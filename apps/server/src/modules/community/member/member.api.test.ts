import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { CommunitySite } from '../../../testing/community-site';
import type { TestMailbox } from '../../../testing/test-mailbox';
import { Database, PasswordHasher, PluginRegistry } from '../../platform';

// 커뮤니티 회원 (스토어 3-1a, 메일 인증 가입 2026-11-26, docs/스토어.md 11장): 앱 도메인에서만 열리는 회원 API, 코드 → 가입 → 회원 쿠키 → 로그인,
// 해킹 대비(실패 문구 하나 · 틀린 시도 제한 · 가입 제한 · 코드 한 번 · 가입한 메일인지 드러내지 않음 · 새 세션 · 비밀번호를 바꾸면 다른 로그인 끝남), 쓰기의 출처 · CSRF 확인,
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
const PASSWORD = CommunitySite.PASSWORD;
let appId = '';
let appVersion = 0;
let hostSeq = 0;
let ipSeq = 0;
let mailbox: TestMailbox;

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

/** 메일 인증 가입 한 번 (코드를 주면 그 코드로, 안 주면 테스트 메일함에서 새로 받아서) */
function join(body: Json & { email: string }, host = HOST, ip = nextIp()): Promise<ApiResult> {
  return CommunitySite.join(api, host, body, ip);
}

/** 가입까지 마친 회원의 브라우저 (메일은 이름@example.com) */
async function member(name: string, nickname: string, host = HOST): Promise<TestUser> {
  const res = await join({ email: CommunitySite.emailOf(name), nickname }, host);
  assert.equal(res.status, 201, res.text);
  return new TestUser(res.cookies());
}

/** 로그인 { login: 메일 또는 옛 아이디 } */
function login(account: string, password: string, host = HOST): Promise<ApiResult> {
  return at('/api/community/login', { method: 'POST', body: { login: account, password } }, host);
}

/** 인증코드 보내기 (가입 join · 비밀번호 password) */
function sendCode(
  use: 'join' | 'password',
  email: string,
  host = HOST,
  ip = nextIp(),
): Promise<ApiResult> {
  return at(
    `/api/community/${use}/code`,
    { method: 'POST', body: { email }, headers: { 'x-forwarded-for': ip } },
    host,
  );
}

async function csrfOf(browser: TestUser, host = HOST): Promise<string> {
  return String(ok(await at('/api/community/me', { as: browser }, host)).csrf);
}

before(async () => {
  api = await ApiClient.start();
  mailbox = CommunitySite.mailbox(api);
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
    const res = await api.request('POST', '/api/community/join/code', TestUser.visitor, {
      email: 'mainsite@example.com',
    });
    assert.equal(res.status, 404);
  });

  test('공개된 커뮤니티 앱의 도메인에서만: 블로그 앱 · 비공개 커뮤니티 앱의 도메인은 404', async () => {
    await newApp('blog', `blog-${mark}`, `blog-${mark}.example.com`);
    await newApp('community', `shut-${mark}`, `shut-${mark}.example.com`, false);
    assert.equal((await at('/api/community/me', {}, `blog-${mark}.example.com`)).status, 404);
    assert.equal((await at('/api/community/me', {}, `shut-${mark}.example.com`)).status, 404);
    assert.deepEqual(ok(await at('/api/community/me')), {
      account: null,
      member: null,
      csrf: null,
    });
  });

  test('관리자 경로(/api/community/admin)와 다른 관리 API는 앱 도메인에서 404', async () => {
    assert.equal((await at('/api/community/admin/x')).status, 404);
    assert.equal((await at('/api/agents', { as: owner })).status, 404);
  });
});

describe('메일 인증 가입', () => {
  test('코드를 받아 가입하면 바로 로그인된다: 회원 쿠키 · 자기 정보 · 쓰기 확인 값 (비밀번호 해시 · 코드는 어디에도 없다)', async () => {
    const email = CommunitySite.emailOf(`villager${mark}`);
    assert.equal((await sendCode('join', `  ${email.toUpperCase()} `)).status, 204);
    const mail = mailbox.to(email).at(-1);
    assert.match(mail?.subject ?? '', new RegExp(`^\\[앱 town-${mark}\\] 가입 인증코드 \\d{6}$`));
    const res = await join({ email, code: mailbox.codeFor(email), nickname: '마을사람' });
    const self = ok(res, 201);
    assert.equal((self.account as Json).email, email);
    assert.equal((self.account as Json).loginId, CommunitySite.loginIdOf(email));
    assert.equal((self.member as Json).nickname, '마을사람');
    assert.ok(res.cookies().moida_member);
    assert.doesNotMatch(res.text, /scrypt/);
    const me = ok(await at('/api/community/me', { as: new TestUser(res.cookies()) }));
    assert.equal((me.member as Json).nickname, '마을사람');
    assert.equal(typeof me.csrf, 'string');
    const [row] = await api.service(Database).sql<Json[]>`
      SELECT * FROM community.accounts WHERE email = ${email}`;
    assert.doesNotMatch(JSON.stringify(row), new RegExp(mailbox.codeFor(email)));
  });

  test('가입한 메일로 코드를 달라면 답은 같고(204) 코드 대신 "이미 가입한 메일" 안내가 간다', async () => {
    await member(`twice${mark}`, '두번가입');
    const email = CommunitySite.emailOf(`twice${mark}`);
    const before = mailbox.to(email).length;
    assert.equal((await sendCode('join', email)).status, 204);
    const mail = mailbox.to(email).at(-1);
    assert.equal(mailbox.to(email).length, before + 1);
    assert.match(mail?.subject ?? '', /이미 가입한 메일/);
    assert.doesNotMatch(mail?.text ?? '', /\d{6}/);
  });

  test('규칙: 틀린 코드 · 만 14세 확인 · 쉬운 비밀번호는 거절, 겹친 닉네임은 409, 메일 모양이 아니면 400', async () => {
    const host = await freshHost();
    await member('nick_owner', '겹칠이름', host);
    const email = CommunitySite.emailOf('rules_long1');
    assert.equal((await sendCode('join', email, host)).status, 204);
    const code = mailbox.codeFor(email);
    const try1 = (body: Json) =>
      join({ email, code, nickname: '규칙', ...body }, host, '10.98.0.1');
    assert.match(
      (await try1({ code: code === '000000' ? '111111' : '000000' })).text,
      /인증코드가 맞지 않거나/,
    );
    assert.match((await try1({ ageConfirmed: false })).text, /만 14세/);
    assert.equal((await try1({ password: 'short' })).status, 422);
    assert.match((await try1({ password: 'rules_long1' })).text, /같은 비밀번호/);
    assert.match((await try1({ nickname: '겹칠이름' })).text, /이미 쓰는 닉네임/);
    assert.equal((await try1({})).status, 201);
    assert.match(
      (await try1({ nickname: '다시' })).text,
      /인증코드가 맞지 않거나/,
      '코드는 한 번만',
    );
    assert.equal((await sendCode('join', 'not-an-email', host)).status, 400);
  });

  test('다시 받기는 60초 뒤부터 (429), 코드는 5번 틀리면 버려진다', async () => {
    const host = await freshHost();
    const email = CommunitySite.emailOf('wrong_code');
    assert.equal((await sendCode('join', email, host)).status, 204);
    assert.match((await sendCode('join', email, host)).text, /초 뒤에 다시 받을 수 있어요/);
    const code = mailbox.codeFor(email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1)
      assert.equal((await join({ email, code: wrong, nickname: '틀림' }, host)).status, 400);
    assert.equal(
      (await join({ email, code, nickname: '틀림' }, host)).status,
      400,
      '맞는 코드도 늦었다',
    );
  });

  test('메일을 보낼 수 없으면(메일 플러그인 없음) 코드를 보내지 않는다 (502)', async () => {
    const registry = api.service(PluginRegistry as unknown as new () => PluginRegistry);
    const saved = registry.mailer;
    registry.mailer = () => null;
    try {
      const res = await sendCode('join', CommunitySite.emailOf('no_mail'));
      assert.equal(res.status, 502);
      assert.match(res.text, /메일 플러그인/);
    } finally {
      registry.mailer = saved;
    }
  });

  test('가입은 한 곳에서 1시간에 3번까지', async () => {
    const host = await freshHost();
    const ip = '10.99.0.1';
    const signUp = (name: string, from = ip) =>
      join({ email: CommunitySite.emailOf(name), nickname: name }, host, from);
    assert.equal((await signUp('spam_one')).status, 201);
    assert.equal((await signUp('spam_two')).status, 201);
    assert.equal((await signUp('spam_three')).status, 201);
    assert.equal((await signUp('spam_four')).status, 429);
    assert.equal((await signUp('spam_five', nextIp())).status, 201, '다른 곳은 그대로');
  });
});

describe('로그인', () => {
  test('메일 + 비밀번호: 맞으면 새 세션, 틀린 비밀번호와 없는 메일은 같은 문구', async () => {
    await member('login_ok', '로그인됨');
    const res = await login(CommunitySite.emailOf('login_ok').toUpperCase(), PASSWORD);
    const self = ok(res);
    assert.equal(self.email, CommunitySite.emailOf('login_ok'));
    assert.equal(self.loginId, CommunitySite.loginIdOf(CommunitySite.emailOf('login_ok')));
    assert.ok(res.cookies().moida_member);
    const wrong = await login(CommunitySite.emailOf('login_ok'), '틀린 비밀번호입니다');
    const missing = await login(CommunitySite.emailOf('nobody_here'), PASSWORD);
    assert.equal(wrong.status, 401);
    assert.equal(missing.status, 401);
    assert.equal(wrong.json().message, missing.json().message);
  });

  test('아이디로 로그인한다: 메일 없이 옮겨 온 옛 계정은 needs로 빈 메일 · 약관을 알리고, 참여 전이라 member는 null', async () => {
    const hash = await api.service(PasswordHasher).hash(PASSWORD);
    await api.service(Database).sql`
      INSERT INTO community.accounts (space_id, login_id, password_hash, password_changed_at, age_confirmed_at)
      SELECT DISTINCT space_id, 'old_villager', ${hash}, now(), now() FROM community.terms WHERE space_id IS NOT NULL LIMIT 1`;
    const res = await login('Old_Villager', PASSWORD);
    const self = ok(res);
    assert.equal(self.loginId, 'old_villager');
    assert.equal(self.email, null);
    assert.deepEqual(self.needs, ['email', 'terms']);
    const me = ok(await at('/api/community/me', { as: new TestUser(res.cookies()) }));
    assert.equal((me.account as Json).loginId, 'old_villager');
    assert.equal(me.member, null);
  });

  test('틀린 로그인은 메일마다 15분에 5번까지, 넘으면 맞는 비밀번호도 429', async () => {
    const host = await freshHost();
    await member('locked_one', '잠길사람', host);
    const email = CommunitySite.emailOf('locked_one');
    for (let i = 0; i < 5; i += 1)
      assert.equal((await login(email, `틀린 비밀번호 ${i}번째`, host)).status, 401);
    assert.equal((await login(email, PASSWORD, host)).status, 429);
  });
});

describe('비밀번호 다시 정하기 (메일 인증코드)', () => {
  test('가입한 메일로만 코드가 가고, 새 비밀번호를 정하면 모든 로그인이 끝난다', async () => {
    const host = await freshHost();
    const first = await member('forgot_me', '잊은사람', host);
    const email = CommunitySite.emailOf('forgot_me');
    const stranger = CommunitySite.emailOf('stranger_x');
    assert.equal((await sendCode('password', stranger, host)).status, 204);
    assert.equal(mailbox.to(stranger).length, 0, '가입하지 않은 메일에는 보내지 않는다');
    assert.equal((await sendCode('password', email, host)).status, 204);
    const code = mailbox.codeFor(email);
    const reset = (body: Json) =>
      at('/api/community/password/reset', { method: 'POST', body: { email, code, ...body } }, host);
    assert.equal((await reset({ password: '새 비밀번호', code: '12345' })).status, 400);
    assert.equal((await reset({ password: 'short' })).status, 422);
    assert.equal((await reset({ password: '메일로 다시 정한 비밀번호' })).status, 204);
    assert.equal(ok(await at('/api/community/me', { as: first }, host)).member, null);
    assert.equal((await login(email, PASSWORD, host)).status, 401);
    ok(await login(email, '메일로 다시 정한 비밀번호', host));
    assert.equal((await reset({ password: '한 번 더 바꾸기' })).status, 400, '코드는 한 번만');
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
        headers: { 'x-moida-csrf': csrf },
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
          body: { login: CommunitySite.emailOf('change_pw'), password: PASSWORD },
        })
      ).cookies(),
    );
    const csrf = await csrfOf(first);
    const change = (current: string, next: string) =>
      at('/api/community/me/password', {
        method: 'PATCH',
        as: first,
        body: { current, next },
        headers: { 'x-moida-csrf': csrf },
      });
    assert.match(
      (await change('틀린 지금 비밀번호', '새로운 긴 비밀번호입니다')).text,
      /지금 비밀번호/,
    );
    assert.equal((await change(PASSWORD, 'change_pw')).status, 422, '메일의 @ 앞과 같은 비밀번호');
    assert.equal((await change(PASSWORD, '새로운 긴 비밀번호입니다')).status, 204);
    assert.notEqual(ok(await at('/api/community/me', { as: first })).member, null);
    assert.equal(ok(await at('/api/community/me', { as: second })).member, null);
    const old = await at('/api/community/login', {
      method: 'POST',
      body: { login: CommunitySite.emailOf('change_pw'), password: PASSWORD },
    });
    assert.equal(old.status, 401);

    // 끝난 로그인의 쿠키가 남은 브라우저: me가 그 쿠키의 확인 값을 주어 다시 로그인할 수 있다
    const stale = ok(await at('/api/community/me', { as: second }));
    assert.equal(stale.member, null);
    assert.ok(stale.csrf, '쿠키가 있으면 로그인이 끝났어도 확인 값');
    const again = (headers: Record<string, string>) =>
      at('/api/community/login', {
        method: 'POST',
        as: second,
        body: { login: CommunitySite.emailOf('change_pw'), password: '새로운 긴 비밀번호입니다' },
        headers,
      });
    assert.equal((await again({})).status, 403, '쿠키를 실었으면 확인 값이 있어야');
    assert.equal((await again({ 'x-moida-csrf': String(stale.csrf) })).status, 200);
  });

  test('로그아웃하면 그 쿠키는 더 회원이 아니다', async () => {
    const me = await member('logout_me', '나갈사람');
    const csrf = await csrfOf(me);
    const out = await at('/api/community/logout', {
      method: 'POST',
      as: me,
      headers: { 'x-moida-csrf': csrf },
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
      (await patch({ 'sec-fetch-site': 'cross-site', 'x-moida-csrf': csrf })).status,
      403,
    );
    assert.equal(
      (await patch({ origin: 'https://evil.example', 'x-moida-csrf': csrf })).status,
      403,
    );
    assert.equal((await patch({ origin: ORIGIN })).status, 403);
  });

  test('다른 사이트가 남의 브라우저로 로그인 · 가입을 보내면 403 (쿠키가 없어도)', async () => {
    const res = await api.viaHost('/api/community/login', HOST, {
      method: 'POST',
      body: { login: CommunitySite.emailOf('careful_one'), password: PASSWORD },
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
