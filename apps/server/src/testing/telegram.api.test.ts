import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';
import { Database, OutboxWorker } from '../modules/platform';
import { ApiClient, type ApiResult, TestUser } from './api-client';

// 기능 패키지 messenger-telegram (2026-11-23): 텔레그램 봇으로 대표와 대화한다.
// 보는 사람별: 방문자 · write 기기는 콘솔 API에 닿지 못하고, 웹훅은 열쇠가 맞는 텔레그램의 요청만 받는다.
// 텔레그램 API는 테스트용 웹 서버가 받는다 (보낸 글을 모아 둔다).

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 테스트 (모양은 assert가 본다)
type Json = Record<string, any>;
const BASE = '/api/p/messenger-telegram';
const TOKEN = '123456:test-only-telegram-token';
const KEY = createHash('sha256').update(`cairn-telegram-hook:${TOKEN}`).digest('hex').slice(0, 40);
const SITE = 'https://cairn.example';

let api: ApiClient;
let owner: TestUser;
let db: Database;
let runner: string;
let fake: Server;
/** 테스트용 텔레그램 API가 받은 호출 (메서드 · 본문) */
const calls: { method: string; body: Json }[] = [];
let update = 1000;

const ok = (res: ApiResult, status = 200): Json => {
  assert.equal(res.status, status, res.text);
  return res.json() as Json;
};
const drain = async () => {
  const worker = api.service(OutboxWorker);
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
};
const sent = (chatId: number) =>
  calls
    .filter((c) => c.method === 'sendMessage' && c.body.chat_id === chatId)
    .map((c) => c.body.text as string);

/** 텔레그램이 웹훅으로 보내는 1:1 메시지 */
function message(userId: number, text: string, updateId = ++update): Json {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      text,
      from: { id: userId, is_bot: false, first_name: '나' },
      chat: { id: userId, type: 'private' },
      date: 1,
    },
  };
}
const hook = (body: Json, key = KEY) =>
  api.request('POST', `${BASE}/hook/${key}`, TestUser.visitor, body);

async function tool(name: string, args: Json = {}): Promise<Json> {
  const res = await api.mcp(runner, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as Json;
  assert.ok(!result.isError, JSON.stringify(result));
  return result.structuredContent ?? {};
}

/** 연결 코드를 받아 그 사용자가 봇에게 보낸다 */
async function pair(userId: number): Promise<void> {
  const { code } = ok(await api.request('POST', `${BASE}/pairings`, owner));
  ok(await hook(message(userId, `/start ${code}`)));
  await drain();
}

before(async () => {
  fake = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      const method = String(req.url).split('/').at(-1) ?? '';
      assert.ok(String(req.url).startsWith(`/bot${TOKEN}/`), '봇 토큰이 주소에');
      calls.push({ method, body: raw ? JSON.parse(raw) : {} });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: true }));
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  const address = fake.address();
  const apiUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, {
    name: '텔레그램',
    siteUrl: api.baseUrl,
    version,
  });
  runner = await api.connectDevice(owner, 'telegram-runner');
  const { devices } = ok(await api.get('/api/devices', owner)) as { devices: Json[] };
  const device = devices.find((d) => d.name === 'telegram-runner') as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...device.scopes, 'run'],
      version: device.version,
    }),
  );
  ok(await api.request('POST', '/api/plugins/messenger-telegram/enable', owner));
  ok(
    await api.request('PUT', '/api/plugins/messenger-telegram/settings', owner, {
      values: { token: TOKEN, siteUrl: `${SITE}/`, apiUrl },
    }),
  );
});
after(async () => {
  await api.close();
  await new Promise<void>((r) => fake.close(() => r()));
});

/** 이 테스트의 일만 빌려 가게 앞 테스트가 남긴 일을 치운다 */
beforeEach(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});

describe('messenger-telegram', () => {
  test('방문자 · write 기기는 콘솔 API에 닿지 못하고, 웹훅은 열쇠가 틀리면 404', async () => {
    const writer = {
      authorization: `Bearer ${await api.writeDevice(owner, `tg-writer-${randomUUID().slice(0, 6)}`)}`,
    };
    for (const headers of [{}, writer])
      for (const [method, path] of <[string, string][]>[
        ['GET', `${BASE}/links`],
        ['POST', `${BASE}/pairings`],
        ['POST', `${BASE}/links/${randomUUID()}/unlink`],
      ]) {
        const res = await api.request(method, path, TestUser.visitor, undefined, headers);
        assert.ok([401, 403].includes(res.status), `${method} ${path} ${res.status}`);
      }
    assert.equal((await hook(message(1, '안녕'), 'f'.repeat(40))).status, 404);
    const listed = ok(await api.get(`${BASE}/links`, owner));
    assert.equal(listed.ready, true, '봇 토큰 · 바깥 주소가 채워졌다');
  });

  test('웹훅 연결은 바깥 주소 + 봇 토큰에서 만든 열쇠로', async () => {
    const res = ok(
      await api.request('POST', '/api/plugins/messenger-telegram/actions/connect', owner),
    );
    assert.equal(res.ok, true, JSON.stringify(res));
    const set = calls.findLast((c) => c.method === 'setWebhook');
    assert.equal(set?.body.url, `${SITE}${BASE}/hook/${KEY}`);
    assert.deepEqual(set?.body.allowed_updates, ['message']);
  });

  test('모르는 계정의 말은 답하지 않고 버린다 · 틀린 코드도', async () => {
    const before = calls.length;
    ok(await hook(message(501, '내 말 들어 줘')));
    ok(await hook(message(501, 'ABCD2345')));
    ok(await hook({ update_id: ++update, edited_message: { text: 'x' } }));
    await drain();
    assert.equal(calls.length, before, '보낸 것이 없다');
  });

  test('연결 코드 → 말 하나 = 대화의 회차 → 답이 텔레그램으로', async () => {
    const user = 700 + Math.floor(Math.random() * 100);
    await pair(user);
    assert.match(sent(user).at(-1) ?? '', /^연결했어요/);
    const { links } = ok(await api.get(`${BASE}/links`, owner));
    const link = links.find((l: Json) => l.name === '나' && l.currentChat === null);
    assert.ok(link, JSON.stringify(links));

    const said = message(user, '텔레그램 주말 계획');
    ok(await hook(said));
    ok(await hook(said)); // 텔레그램이 다시 보낸 같은 업데이트
    await drain();
    assert.deepEqual(sent(user).slice(-2), ['맡겼어요 · 1번째', '맡겼어요 · 1번째']);
    const { chats } = ok(await api.get('/api/chats', owner));
    const chat = chats.find((c: Json) => c.title === '텔레그램 주말 계획');
    assert.ok(chat, '관리자의 대화가 열렸다');
    assert.equal(chats.filter((c: Json) => c.title === '텔레그램 주말 계획').length, 1, '한 번만');

    ok(await hook(message(user, '예산은 10만 원')));
    await drain();
    assert.equal(sent(user).at(-1), '덧붙였어요 · 일하는 중');

    const { jobs } = await tool('next_jobs', { limit: 5 });
    const job = jobs.find((j: Json) => j.task.title.includes('주말 계획'));
    assert.ok(job, JSON.stringify(jobs.map((j: Json) => j.task.title)));
    await tool('submit_result', {
      task_id: job.task.id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '## 계획\n- 토요일 성수' },
    });
    await drain();
    const answer = sent(user).at(-1) ?? '';
    assert.match(answer, /^텔레그램 주말 계획\n\n## 계획\n- 토요일 성수/);
    assert.ok(answer.endsWith(`HTML로 보기: ${SITE}/admin/chats/${chat.id}/report`), answer);

    ok(await hook(message(user, '/new')));
    ok(await hook(message(user, '다른 일: 책 추천')));
    await drain();
    const after = ok(await api.get('/api/chats', owner)).chats as Json[];
    const other = after.find((c) => c.title === '다른 일: 책 추천');
    assert.ok(other && other.id !== chat.id, '/new 뒤의 말은 새 대화');
    assert.ok(sent(user).includes('다음 말부터 새 대화예요'));
  });

  test('결과 카드가 생기면 고를 것이 있다고 알린다 (승인은 콘솔에서)', async () => {
    const user = 900 + Math.floor(Math.random() * 50);
    await pair(user);
    ok(await hook(message(user, '/new 글 하나 써서 올려 줘')));
    await drain();
    const chat = (ok(await api.get('/api/chats', owner)).chats as Json[]).find(
      (c) => c.title === '글 하나 써서 올려 줘',
    ) as Json;
    const card = await db.sql`
      SELECT id FROM task.approvals WHERE target_id = ${chat.id} AND action = 'task.chat.result'`;
    assert.equal(card.length, 0, '아직 카드가 없다');
    // 카드 이벤트를 받은 것처럼 (결과 카드를 만드는 흐름은 chat-result 테스트가 본다)
    await db.sql`
      INSERT INTO platform.outbox (topic, space_id, payload)
      SELECT 'task.approval.requested', space_id, ${db.sql.json({
        v: 1,
        approvalId: randomUUID(),
        taskId: null,
        agentId: null,
        action: 'task.chat.result',
        targetKind: 'chat',
        targetId: chat.id,
        targetVersion: 1,
        decidedBy: null,
        note: null,
        chatId: chat.id,
        payload: null,
      })}
      FROM task.chats WHERE id = ${chat.id}`;
    await drain();
    assert.match(
      sent(user).at(-1) ?? '',
      new RegExp(`승인은 콘솔에서: ${SITE}/admin/chats/${chat.id}$`),
    );
  });

  test('연결을 끊으면 그 계정의 말을 받지 않는다', async () => {
    const user = 960 + Math.floor(Math.random() * 30);
    await pair(user);
    const { links } = ok(await api.get(`${BASE}/links`, owner));
    const mine = links.find((l: Json) => l.currentChat === null) as Json;
    ok(await api.request('POST', `${BASE}/links/${mine.id}/unlink`, owner));
    const before = calls.length;
    ok(await hook(message(user, '아직 들려?')));
    await drain();
    assert.equal(calls.length, before);
    assert.equal((await api.request('POST', `${BASE}/links/${mine.id}/unlink`, owner)).status, 404);
  });
});
