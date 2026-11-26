import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { Database, OutboxWorker, PluginRegistry } from '../modules/platform';
import { ApiClient, type ApiResult, TestUser } from './api-client';

// 플러그인 email (2026-11-26): 콘솔의 알림을 관리자의 메일로.
// 보는 사람별: 방문자 · write 기기는 켜기 · 설정 · 테스트 메일을 하지 못한다.
// 운영의 메일 서버는 TLS(465)로만 붙는다: TLS 없는 테스트용 SMTP 서버에는 로그인까지 가지 못하고 실패로 답한다
// (보내기의 주고받기는 plugins/email/server/email.test.ts가 본다).
// 앱 소식 구독: 방문자의 신청 → 확인 → 글 공개 → 소식 → 관리자의 보내기 → 일꾼(deliver) → 해지.

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

describe('앱 소식 구독 (email)', () => {
  const BASE = '/api/p/email';
  const visitor = (path: string, body: object = {}) =>
    api.request('POST', `${BASE}/${path}`, TestUser.visitor, body);
  const drain = async () => {
    const worker = api.service(OutboxWorker);
    for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
  };
  const deliver = async () => {
    // PluginRegistry는 팩토리로 만들어 생성자가 공개돼 있지 않다 (서비스 찾기의 타입만 맞춘다)
    const registry = api.service(PluginRegistry as unknown as new () => PluginRegistry);
    const job = registry.jobs().find((j) => j.plugin === 'email');
    assert.ok(job, '반복 작업 deliver가 등록됐다');
    await api.service(OutboxWorker).runJob(job);
  };
  let appId = '';
  let token = '';

  before(async () => {
    appId = await api.blogApp(owner);
    ok(await api.request('POST', '/api/plugins/email/enable', owner));
    ok(
      await api.request('PUT', '/api/plugins/email/settings', owner, {
        values: {
          host: '127.0.0.1',
          port: String(port),
          user: USER,
          password: PASSWORD,
          siteUrl: 'https://cairn.example',
          subscriptions: 'true',
        },
      }),
    );
  });

  test('신청: 동의 · 주소 모양 · 공개 앱만, 답은 늘 같다 (이미 있는지 드러나지 않는다)', async () => {
    const address = 'Reader@Mail.Example';
    assert.equal(
      (await visitor('subscribe', { apps: ['blog'], address, agree: false })).status,
      422,
    );
    assert.equal(
      (await visitor('subscribe', { apps: ['blog'], address: 'nope', agree: true })).status,
      422,
    );
    assert.equal(
      (await visitor('subscribe', { apps: ['no-such-app'], address, agree: true })).status,
      404,
      '없거나 비공개인 앱',
    );
    const first = ok(await visitor('subscribe', { apps: ['blog'], address, agree: true }));
    const again = ok(await visitor('subscribe', { apps: ['blog'], address, agree: true }));
    assert.deepEqual(first, again);
    const rows = await api.service(Database).sql<
      { address: string; status: string; token: string }[]
    >`
      SELECT address, status, token FROM email.subscribers WHERE app_id = ${appId}`;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.address, 'reader@mail.example', '주소는 소문자로');
    assert.equal(rows[0]?.status, 'pending');
    token = rows[0]?.token ?? '';
  });

  test('일꾼이 확인 메일을 한 번 잡는다 (TLS가 아닌 메일 서버라 실패해도 다시 보내지 않는다)', async () => {
    await deliver();
    const [row] = await api.service(Database).sql<{ sent: Date | null }[]>`
      SELECT confirm_sent_at AS sent FROM email.subscribers WHERE token = ${token}`;
    assert.ok(row?.sent);
  });

  test('확인: 열쇠가 맞아야, 맞으면 구독 중', async () => {
    assert.equal((await visitor(`confirm/${'x'.repeat(43)}`)).status, 404);
    assert.equal((await visitor('confirm/short')).status, 404);
    const done = ok(await visitor(`confirm/${token}`));
    assert.deepEqual(done.apps, ['블로그']);
  });

  test('글이 공개되면 소식이 생기고, 관리자가 보내기를 눌러야 나간다', async () => {
    const created = await api.request('POST', '/api/posts', owner, {
      appId,
      requestId: randomUUID(),
      title: '구독 소식 글',
      body: '본문',
    });
    assert.equal(created.status, 201, created.text);
    const post = created.json() as Json;
    ok(
      await api.request('POST', `/api/posts/${post.id}/status`, owner, {
        version: post.version,
        status: 'published',
      }),
    );
    await drain();
    const view = ok(await api.get(`${BASE}/overview`, owner));
    const send = (view.sends as Json[]).find((s) => s.title === '구독 소식 글');
    assert.ok(send);
    assert.equal(send.status, 'ready');
    assert.equal(send.total, 1);
    assert.equal(send.link, `https://cairn.example/blog/posts/${encodeURIComponent(post.slug)}`);
    assert.equal((await api.get(`${BASE}/overview`, TestUser.visitor)).status, 403);
    assert.equal((await visitor(`sends/${send.id}/start`)).status, 403);

    ok(await api.request('POST', `${BASE}/sends/${send.id}/start`, owner));
    assert.equal((await api.request('POST', `${BASE}/sends/${send.id}/start`, owner)).status, 409);
    await deliver();
    const after = ok(await api.get(`${BASE}/overview`, owner));
    const finished = (after.sends as Json[]).find((s) => s.id === send.id) as Json;
    assert.equal(finished.status, 'done', '대기열이 비면 끝');
    assert.equal(finished.failed, 1, 'TLS가 아닌 메일 서버라 실패로 적는다');
    const [err] = await api.service(Database).sql<{ error: string }[]>`
      SELECT error FROM email.deliveries WHERE send_id = ${send.id}`;
    assert.doesNotMatch(
      err?.error ?? '',
      /reader@mail\.example/,
      '오류 글에 받는 주소를 남기지 않는다',
    );
  });

  test('해지: 줄을 바로 지우고, 다시 눌러도 같다', async () => {
    const done = ok(await visitor(`unsubscribe/${token}`));
    assert.deepEqual(done.apps, ['블로그']);
    const [left] = await api.service(Database).sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM email.subscribers WHERE token = ${token}`;
    assert.equal(left?.n, 0);
    assert.deepEqual(ok(await visitor(`unsubscribe/${token}`)).apps, []);
  });
});
