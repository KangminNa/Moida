import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ApiClient, TestUser } from '../../../testing/api-client';

// 쿠키 이름의 __Host- 앞머리 (3-5 보안 검토, 2026-11-27): https면 서버가 주는 쿠키는 __Host-<이름>(Secure · Path=/ · Domain 없음)이고,
// 읽을 때도 그 이름만 본다. 하위 도메인(공통 앱 도메인)의 스크립트가 Domain=<사이트>로 심은 같은 이름(앞머리 없는 이름)의 쿠키는
// 로그인으로 치지 않는다. http(개발)에서는 브라우저가 __Host- 쿠키를 받지 않아 앞머리 없이 그대로

let api: ApiClient;
const HTTPS = { 'x-forwarded-proto': 'https' };

before(async () => {
  api = await ApiClient.start();
  await api.signIn();
});
after(() => api.close());

describe('쿠키 앞머리', () => {
  test('https 로그인은 __Host- 쿠키(Secure · Path=/ · Domain 없음)를 주고, 그 쿠키로만 관리자다', async () => {
    const res = await api.request(
      'POST',
      '/api/auth/login',
      TestUser.visitor,
      { login: ApiClient.OWNER_LOGIN, password: ApiClient.OWNER_PASSWORD },
      HTTPS,
    );
    assert.equal(res.status, 200, res.text);
    const line = res.setCookies().find((l) => l.startsWith('__Host-moida_session='));
    assert.ok(line, res.setCookies().join(' | '));
    assert.match(line, /;\s*Secure/i);
    assert.match(line, /;\s*Path=\/(;|$)/);
    assert.doesNotMatch(line, /Domain=/i);
    const token = res.cookies()['__Host-moida_session'] ?? '';

    const prefixed = new TestUser({ '__Host-moida_session': token });
    assert.equal(
      (await api.request('GET', '/api/auth/me', prefixed, undefined, HTTPS)).status,
      200,
    );
    // 하위 도메인이 심을 수 있는 앞머리 없는 이름은 https에서 읽지 않는다
    const planted = new TestUser({ moida_session: token });
    assert.notEqual(
      (await api.request('GET', '/api/auth/me', planted, undefined, HTTPS)).status,
      200,
    );
  });

  test('http에서는 앞머리 없이 그대로 (개발 서버)', async () => {
    const res = await api.login(ApiClient.OWNER_LOGIN, ApiClient.OWNER_PASSWORD);
    assert.equal(res.status, 200);
    assert.ok(res.cookies().moida_session);
    assert.equal(res.cookies()['__Host-moida_session'], undefined);
  });
  test('옛 이름의 쿠키(cairn_session, 2026-11-28 이름 바꾸기 전의 로그인)도 끝날 때까지 읽는다', async () => {
    const res = await api.login(ApiClient.OWNER_LOGIN, ApiClient.OWNER_PASSWORD);
    const token = res.cookies().moida_session ?? '';
    assert.ok(token);
    const old = new TestUser({ cairn_session: token });
    assert.equal((await api.request('GET', '/api/auth/me', old)).status, 200);
    // https에서는 옛 이름도 __Host- 이름만 읽는다 (하위 도메인이 심은 앞머리 없는 이름은 아니다)
    const hosted = new TestUser({ '__Host-cairn_session': token });
    assert.equal((await api.request('GET', '/api/auth/me', hosted, undefined, HTTPS)).status, 200);
    const planted = new TestUser({ cairn_session: token });
    assert.notEqual(
      (await api.request('GET', '/api/auth/me', planted, undefined, HTTPS)).status,
      200,
    );
  });
});
