import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { TestMailbox } from '../../../testing/test-mailbox';
import { Database, PluginRegistry } from '../../platform';

// 관리자 비밀번호를 메일 인증코드로 다시 정하기 · 로그인 메일 바꾸기 (2026-11-26).
// 보는 사람별: 방문자(코드 요청 · 다시 정하기는 누구나 부르지만 관리자 메일에만 코드가 간다) · 관리자(로그인 메일 바꾸기) · 회원 아닌 방문자(바꾸기 401)

let api: ApiClient;
let owner: TestUser;
let mailbox: TestMailbox;
const EMAIL = ApiClient.OWNER_LOGIN;
const NEW_PASSWORD = '메일로 다시 정한 관리자 비밀번호';

function post(path: string, body: object, as = TestUser.visitor): Promise<ApiResult> {
  return api.request('POST', path, as, body);
}

before(async () => {
  api = await ApiClient.start();
  mailbox = TestMailbox.install(api);
  owner = await api.signIn();
});
after(async () => {
  await api.close();
});

describe('비밀번호를 잊었을 때 (방문자)', () => {
  test('관리자 메일로만 코드가 가고, 다른 메일은 답만 같다 (204)', async () => {
    assert.equal(
      (await post('/api/auth/password/code', { email: 'nobody@example.com' })).status,
      204,
    );
    assert.equal(mailbox.to('nobody@example.com').length, 0);
    assert.equal((await post('/api/auth/password/code', { email: 'not-mail' })).status, 400);
    assert.equal(
      (await post('/api/auth/password/code', { email: ' OWNER@example.com' })).status,
      204,
    );
    assert.match(
      mailbox.to(EMAIL).at(-1)?.subject ?? '',
      /관리자 비밀번호 다시 정하기 인증코드 \d{6}/,
    );
  });

  test('코드로 새 비밀번호를 정하면 모든 로그인이 끝나고 보안 기록에 남는다', async () => {
    const code = mailbox.codeFor(EMAIL);
    const reset = (body: object) =>
      post('/api/auth/password/reset', { email: EMAIL, code, ...body });
    assert.equal((await reset({ code: '12345', password: NEW_PASSWORD })).status, 400);
    assert.equal((await reset({ password: 'short' })).status, 400);
    assert.equal((await reset({ password: NEW_PASSWORD })).status, 204);
    assert.equal((await api.get('/api/auth/me', owner)).status, 401, '로그인이 끝났다');
    assert.equal((await api.login(EMAIL, ApiClient.OWNER_PASSWORD)).status, 401);
    const back = await api.login(EMAIL, NEW_PASSWORD);
    assert.equal(back.status, 200);
    owner = new TestUser({ cairn_session: back.cookies().cairn_session ?? '' });
    assert.equal(
      (await reset({ password: '한 번 더 바꾸기 비밀번호' })).status,
      400,
      '코드는 한 번만',
    );
    const [row] = await api.service(Database).sql<{ detail: { reason: string } }[]>`
      SELECT detail FROM platform.security_events WHERE kind = 'password.changed'
      ORDER BY at DESC LIMIT 1`;
    assert.equal(row?.detail.reason, 'mail');
  });

  test('메일을 보낼 수 없으면(메일 플러그인 없음) 502', async () => {
    const registry = api.service(PluginRegistry as unknown as new () => PluginRegistry);
    const saved = registry.mailer;
    registry.mailer = () => null;
    try {
      const res = await post('/api/auth/password/code', { email: EMAIL });
      assert.equal(res.status, 502);
    } finally {
      registry.mailer = saved;
    }
  });
});

describe('로그인 메일 바꾸기 (관리자)', () => {
  test('새 메일로 받은 코드와 지금 비밀번호가 맞아야 바뀌고, 로그인은 그대로다', async () => {
    const next = 'admin-next@example.com';
    assert.equal((await post('/api/auth/email/code', { email: next })).status, 403);
    assert.equal((await post('/api/auth/email/code', { email: next }, owner)).status, 204);
    const code = mailbox.codeFor(next);
    const change = (body: object, as = owner) =>
      api.request('PUT', '/api/auth/email', as, { email: next, code, ...body });
    assert.equal((await change({ password: NEW_PASSWORD }, TestUser.visitor)).status, 401);
    assert.equal((await change({ password: '틀린 지금 비밀번호예요' })).status, 400);
    const res = await change({ password: NEW_PASSWORD });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json().login, next);
    assert.equal((await api.get('/api/auth/me', owner)).status, 200, '로그인은 그대로');
    assert.equal((await api.login(next, NEW_PASSWORD)).status, 200);
    // 되돌려 둔다 (같은 DB를 쓰는 다른 테스트가 처음 메일로 로그인한다)
    assert.equal((await post('/api/auth/email/code', { email: EMAIL }, owner)).status, 204);
    const back = await api.request('PUT', '/api/auth/email', owner, {
      email: EMAIL,
      code: mailbox.codeFor(EMAIL),
      password: NEW_PASSWORD,
    });
    assert.equal(back.status, 200, back.text);
  });
});

describe('되돌리기', () => {
  test('비밀번호를 처음 것으로 (같은 DB를 쓰는 다른 테스트가 처음 비밀번호로 로그인한다)', async () => {
    const res = await api.request('PUT', '/api/auth/password', owner, {
      current: NEW_PASSWORD,
      next: ApiClient.OWNER_PASSWORD,
    });
    assert.equal(res.status, 200, res.text);
  });
});
