import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from './api-client';

// 플러그인 email (2026-11-26): 콘솔의 알림을 관리자의 메일로.
// 보는 사람별: 방문자 · write 기기는 켜기 · 설정 · 테스트 메일을 하지 못한다.
// 운영의 메일 서버는 TLS(465)로만 붙는다: TLS 없는 테스트용 SMTP 서버에는 로그인까지 가지 못하고 실패로 답한다
// (보내기의 주고받기는 plugins/email/server/email.test.ts가 본다).

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 읽는 테스트 (모양은 assert가 본다)
type Json = Record<string, any>;
const USER = 'me@gmail.example';
const PASSWORD = 'abcd efgh ijkl mnop';
let api: ApiClient;
let owner: TestUser;
/** TLS 없이 받는 테스트용 메일 서버: 인사만 하고 받은 글을 모아 둔다 */
let smtp: Server;
let port = 0;
let received = '';

const ok = (res: ApiResult, status = 200): Json => {
  assert.equal(res.status, status, res.text);
  return res.json() as Json;
};
const action = (headers: Readonly<Record<string, string>> = {}, as = owner) =>
  api.request('POST', '/api/plugins/email/actions/test', as, undefined, headers);

before(async () => {
  smtp = createServer((socket) => {
    socket.write('220 fake.smtp ready\r\n');
    socket.on('data', (chunk) => {
      received += chunk.toString('latin1');
    });
  });
  await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', r));
  const address = smtp.address();
  port = typeof address === 'object' && address ? address.port : 0;
  api = await ApiClient.start();
  owner = await api.signIn();
});
after(async () => {
  await api.close();
  smtp.close();
});

describe('알림 메일 (email)', () => {
  test('방문자 · write 기기는 켜지도, 테스트 메일을 보내지도 못한다 (403)', async () => {
    const writer = { authorization: `Bearer ${await api.writeDevice(owner, 'email-writer')}` };
    for (const headers of [{}, writer]) {
      const enable = await api.request(
        'POST',
        '/api/plugins/email/enable',
        TestUser.visitor,
        undefined,
        headers,
      );
      assert.equal(enable.status, 403, enable.text);
      const res = await action(headers, TestUser.visitor);
      assert.equal(res.status, 403, res.text);
    }
  });

  test('칸을 채우기 전에는 테스트 메일이 무엇을 채울지 알려 준다', async () => {
    ok(await api.request('POST', '/api/plugins/email/enable', owner));
    const answer = ok(await action());
    assert.equal(answer.ok, false);
    assert.match(answer.message, /앱 비밀번호/);
  });

  test('비밀번호는 목록에 나가지 않고, TLS가 아닌 메일 서버에는 로그인하지 않는다', async () => {
    ok(
      await api.request('PUT', '/api/plugins/email/settings', owner, {
        values: {
          host: '127.0.0.1',
          port: String(port),
          user: USER,
          password: PASSWORD,
          siteUrl: 'https://cairn.example',
        },
      }),
    );
    const list = ok(await api.get('/api/plugins', owner)).plugins as Json[];
    const email = list.find((p) => p.name === 'email') as Json;
    assert.doesNotMatch(JSON.stringify(email), /abcd efgh/);
    const answer = ok(await action());
    assert.equal(answer.ok, false);
    assert.match(answer.message, /메일 서버 호출에 실패했어요/);
    assert.doesNotMatch(answer.message, /abcd efgh/);
    assert.doesNotMatch(
      received,
      /AUTH|EHLO/,
      'TLS 인사(ClientHello)만 가고 로그인 줄은 가지 않는다',
    );
  });
});
