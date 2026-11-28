import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';

// 보안 기록 (설정 › 보안, 2026-11-15): 로그인 성공 · 실패 · 로그아웃 · 끝내기 · 거부된 접근이 남고 관리자만 본다.
// 로그인한 곳 목록과 끝내기 (api/auth/sessions)도 여기서 본다. 비밀번호 · 토큰 값은 어디에도 없다.

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let writer: string;
const agent = `security-test/${randomUUID().slice(0, 8)}`;
const WRONG = `wrong-${randomUUID()}`;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

const events = async (query = '') =>
  ok(await api.get(`/api/security/events${query ? `?${query}` : ''}`, owner)) as {
    events: Json[];
    next: string | null;
  };
/**
 * 이 시험만의 곳. 1분 안의 같은 사건(종류 · 곳 · 내용)은 한 줄로 합쳐지므로, 127.0.0.1에서 함께 도는 다른 시험 파일의
 * 로그인 · 거부와 섞이지 않게 문서용 IPv6(2001:db8::/32)의 /64 하나를 고른다 (서버는 loopback 프록시의 x-forwarded-for를 믿는다)
 */
const ip = `2001:db8:${randomUUID().slice(0, 4)}:${randomUUID().slice(0, 4)}::7`;
const headers = { 'user-agent': agent, 'x-forwarded-for': ip };
/** 이 시험이 남긴 줄 */
const mine = (list: Json[]) => list.filter((e) => e.ip === ip);

/** 거부된 접근은 응답을 늦추지 않게 기다리지 않고 남긴다: 나타날 때까지 잠깐 다시 읽는다 */
async function deniedUntil(found: (list: Json[]) => boolean): Promise<Json[]> {
  let denied: Json[] = [];
  for (let i = 0; i < 40; i++) {
    denied = mine((await events('group=access')).events);
    if (found(denied)) break;
    await new Promise((done) => setTimeout(done, 50));
  }
  return denied;
}

/** 이 시험의 머리글(user-agent · 곳)로 로그인 */
const login = (name: string, password: string) =>
  api.request('POST', '/api/auth/login', TestUser.visitor, { login: name, password }, headers);

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  writer = await api.writeDevice(owner, `security-writer-${randomUUID().slice(0, 8)}`);
});

after(async () => {
  await api.close();
});

describe('보안 기록: 보는 사람', () => {
  test('방문자 · 기기 토큰(REST에서는 방문자)은 403', async () => {
    assert.equal((await api.get('/api/security/events')).status, 403);
    const res = await api.request('GET', '/api/security/events', TestUser.visitor, undefined, {
      authorization: `Bearer ${writer}`,
    });
    assert.equal(res.status, 403);
  });

  test('거르기 · 커서의 모양이 틀리면 400', async () => {
    assert.equal((await api.get('/api/security/events?group=Login!', owner)).status, 400);
    assert.equal((await api.get('/api/security/events?cursor=nope', owner)).status, 400);
  });
});

describe('보안 기록: 로그인', () => {
  test('틀린 로그인은 남고, 관리자의 아이디일 때만 아이디를 적는다. 1분 안의 같은 실패는 한 줄로 합친다', async () => {
    assert.equal((await login(ApiClient.OWNER_LOGIN, WRONG)).status, 401);
    assert.equal((await login(ApiClient.OWNER_LOGIN, WRONG)).status, 401);
    assert.equal((await login('nobody-here', WRONG)).status, 401);
    const failed = mine((await events('group=login')).events).filter(
      (e) => e.kind === 'login.failed',
    );
    const known = failed.find((e) => e.detail.login === ApiClient.OWNER_LOGIN);
    assert.ok(known, '관리자의 아이디');
    assert.equal(known.count, 2, '두 번이 한 줄');
    assert.equal(known.userAgent, agent);
    assert.equal(known.detail.method, 'password');
    assert.ok(
      failed.some((e) => e.detail.login === null),
      '없는 아이디는 적지 않는다',
    );
    const page = JSON.stringify(await events());
    assert.ok(!page.includes(WRONG), '비밀번호는 어디에도 없다');
    assert.ok(!page.includes('nobody-here'), '관리자의 것이 아닌 아이디도 없다');
    assert.ok(
      !(await events()).events.some(
        (e) => e.kind === 'access.denied' && e.detail.path === '/api/auth/login',
      ),
      '로그인 실패는 거부된 접근으로 한 번 더 남지 않는다',
    );
  });

  test('로그인 · 로그아웃이 남는다', async () => {
    const res = await login(ApiClient.OWNER_LOGIN, ApiClient.OWNER_PASSWORD);
    const session = new TestUser({ moida_session: res.cookies().moida_session ?? '' });
    assert.equal(res.status, 200);
    assert.equal(
      (await api.request('POST', '/api/auth/logout', session, undefined, headers)).status,
      200,
    );
    const kinds = mine((await events()).events).map((e) => e.kind);
    assert.ok(kinds.includes('login.succeeded'));
    assert.ok(kinds.includes('session.logout'));
    const succeeded = mine((await events('group=login')).events).find(
      (e) => e.kind === 'login.succeeded',
    );
    assert.equal(succeeded?.detail.method, 'password');
  });
});

describe('보안 기록: 거부된 접근', () => {
  test('틀린 토큰으로 /mcp를 부르면 남는다. 토큰 값은 남지 않는다', async () => {
    const bad = `bad-${randomUUID()}`;
    const res = await api.request(
      'POST',
      '/mcp',
      TestUser.visitor,
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { ...headers, authorization: `Bearer ${bad}` },
    );
    assert.equal(res.status, 401);
    assert.match(String(res.header('www-authenticate')), /resource_metadata=/);
    const fromMcp = (e: Json) => e.detail.path === '/mcp' && e.detail.credential === 'bearer';
    const denied = await deniedUntil((list) => list.some(fromMcp));
    assert.ok(denied.some(fromMcp), JSON.stringify(denied));
    assert.ok(!JSON.stringify(denied).includes(bad));
  });

  test('아무것도 내밀지 않은 401은 남기지 않고, 관리자 경로의 403은 남긴다', async () => {
    const me = await api.request('GET', '/api/auth/me', TestUser.visitor, undefined, headers);
    assert.equal(me.status, 401);
    await api.request('GET', '/api/agents', TestUser.visitor, undefined, headers);
    const agents = (e: Json) => e.detail.path === '/api/agents' && e.detail.status === 403;
    const denied = await deniedUntil((list) => list.some(agents));
    assert.ok(!denied.some((e) => e.detail.path === '/api/auth/me'));
    assert.ok(denied.some(agents));
  });
});

describe('로그인한 곳', () => {
  test('방문자는 403. 관리자는 끝나지 않은 로그인과 보안 설정 값을 본다 (지금 로그인 표시)', async () => {
    assert.equal((await api.get('/api/auth/sessions')).status, 403);
    const list = ok(await api.get('/api/auth/sessions', owner));
    assert.ok(list.sessions.some((s: Json) => s.current === true));
    assert.deepEqual(list.limits, {
      sessionDays: 30,
      triesPerLogin: 5,
      triesPerPlace: 10,
      windowSeconds: 60,
    });
    assert.ok(!JSON.stringify(list).includes(owner.cookies.moida_session ?? '-'), '토큰 없음');
  });

  test('다른 곳의 로그인 하나를 끝내면 그 쿠키는 주인이 아니다. 지금 로그인은 422, 없는 로그인은 404', async () => {
    const other = new TestUser({
      moida_session:
        (await api.login(ApiClient.OWNER_LOGIN, ApiClient.OWNER_PASSWORD)).cookies()
          .moida_session ?? '',
    });
    const list = ok(await api.get('/api/auth/sessions', owner)).sessions as Json[];
    const current = list.find((s) => s.current);
    const otherRow = ok(await api.get('/api/auth/sessions', other)).sessions.find(
      (s: Json) => s.current,
    );
    assert.equal(
      (await api.request('POST', `/api/auth/sessions/${current?.id}/end`, owner)).status,
      422,
    );
    assert.equal(
      (await api.request('POST', `/api/auth/sessions/${randomUUID()}/end`, owner)).status,
      404,
    );
    ok(await api.request('POST', `/api/auth/sessions/${otherRow.id}/end`, owner));
    ok(await api.request('POST', `/api/auth/sessions/${otherRow.id}/end`, owner), 200);
    assert.equal((await api.get('/api/auth/me', other)).status, 401);
    assert.equal((await api.get('/api/auth/me', owner)).status, 200);
    assert.ok((await events('group=session')).events.some((e) => e.kind === 'session.ended'));
  });

  test('다른 곳 모두 로그아웃: 지금 로그인만 남는다', async () => {
    const other = new TestUser({
      moida_session:
        (await api.login(ApiClient.OWNER_LOGIN, ApiClient.OWNER_PASSWORD)).cookies()
          .moida_session ?? '',
    });
    ok(await api.request('POST', '/api/auth/sessions/end-others', owner));
    assert.equal((await api.get('/api/auth/me', other)).status, 401);
    const list = ok(await api.get('/api/auth/sessions', owner)).sessions as Json[];
    assert.deepEqual(
      list.map((s) => s.current),
      [true],
    );
  });
});
