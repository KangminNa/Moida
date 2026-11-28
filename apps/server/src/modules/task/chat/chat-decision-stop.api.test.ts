import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, type TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';
import { DecisionLapseJob } from '../approval/decision-lapse.job';

// 확인 필요 판단 (L3, 2026-11-28): post_update의 decision.confirm이 대화의 멈춤 기준(stop_mode)에 걸리면
// 고를 안이 있는 승인(task.decision)으로 멈춘다. 고르면 그 안이, 고쳐 말하면 그 말이 payload.decided로 일에 돌아가고,
// 기한(expires_at)이 지나면 서버가 추천안으로 정한다. 되돌리기 어려운 판단은 멈춤 기준과 상관없이 기한 없이 멈춘다

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 테스트 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let worker: OutboxWorker;
let runner: string;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function drain(): Promise<void> {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

async function tool(token: string, name: string, args: Json = {}): Promise<Json> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as { isError?: boolean; structuredContent?: Json };
  assert.ok(!result.isError, JSON.stringify(result));
  return result.structuredContent ?? {};
}

async function turnOf(chatId: string): Promise<Json> {
  const jobs: Json[] = (await tool(runner, 'next_jobs', { limit: 5 })).jobs ?? [];
  const job = jobs.find((j) => j.task.payload.chat?.chatId === chatId);
  assert.ok(job, '회차가 빌려지지 않았다');
  return job;
}

async function openChat(message: string, stopMode?: string): Promise<{ chat: Json; job: Json }> {
  const chat = ok(
    await api.request('POST', '/api/chats', owner, { requestId: randomUUID(), message }),
    201,
  );
  if (stopMode) {
    const { chat: now } = ok(await api.get(`/api/chats/${chat.id}`, owner));
    const tuned = ok(
      await api.request('PATCH', `/api/chats/${chat.id}`, owner, {
        version: now.version,
        model: null,
        effort: null,
        stop_mode: stopMode,
      }),
    );
    assert.equal(tuned.stopMode, stopMode);
  }
  return { chat, job: await turnOf(chat.id) };
}

const taskOf = async (id: string) =>
  (await db.sql`SELECT status, wait_reason, payload FROM task.tasks WHERE id = ${id}`)[0] as Json;

const ASK = {
  chosen: '토요일 2시',
  alternatives: ['일요일 11시', '다음 주 토요일'],
  why: '가장 빠른 빈자리',
  weight: 'high',
};

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '멈춤', siteUrl: api.baseUrl, version });
  runner = await api.connectDevice(owner, 'stop-runner');
  const { devices } = ok(await api.get('/api/devices', owner)) as { devices: Json[] };
  const device = devices.find((d) => d.name === 'stop-runner') as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...device.scopes, 'run'],
      version: device.version,
    }),
  );
});

after(async () => {
  await api.close();
});

beforeEach(async () => {
  await drain();
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
  await db.sql`UPDATE task.approvals SET status = 'cancelled' WHERE status = 'pending'`;
});

describe('확인 필요 판단', () => {
  test('기본(confirm): 알림 판단은 그대로 가고, confirm 판단은 고를 안 승인으로 멈춘다. 고르면 그 안이 일에 돌아간다', async () => {
    const { chat, job } = await openChat('예약 잡아 줘');
    const plain = await tool(job.run_token, 'post_update', {
      kind: 'decision',
      text: '식당 고름',
      decision: ASK,
    });
    assert.equal(plain.waiting, undefined, '확인 필요가 아닌 판단은 멈추지 않는다');
    assert.equal((await taskOf(job.task.id)).status, 'running');

    const stopped = await tool(job.run_token, 'post_update', {
      kind: 'decision',
      text: '방문 시각',
      decision: { ...ASK, confirm: 'direction', wait_minutes: 10 },
    });
    assert.equal(stopped.waiting, 'approval');
    assert.ok(stopped.approval_id);
    const left = Date.parse(stopped.expires_at) - Date.now();
    assert.ok(left > 9 * 60_000 && left <= 10 * 60_000, '기한은 wait_minutes 뒤');
    const waiting = await taskOf(job.task.id);
    assert.deepEqual([waiting.status, waiting.wait_reason], ['waiting', 'approval']);

    // 대화: 판단 칸에 승인 id · 기한, 회차 아래에 그 승인
    const room = ok(await api.get(`/api/chats/${chat.id}`, owner));
    const news = room.news.find((n: Json) => n.text === '방문 시각');
    assert.equal(news.decision.approval_id, stopped.approval_id);
    assert.equal(news.decision.confirm, 'direction');
    assert.deepEqual(room.turns[0].approvalIds, [stopped.approval_id]);
    const shown = ok(await api.get(`/api/approvals/${stopped.approval_id}`, owner));
    assert.equal(shown.action, 'task.decision');
    assert.equal(shown.decision.chosen, '토요일 2시');
    assert.deepEqual(shown.decision.alternatives, ASK.alternatives);
    assert.equal(shown.expiresAt, stopped.expires_at);
    await drain();
    const { notifications } = ok(await api.get('/api/notifications', owner));
    const notice = notifications.find((x: Json) => x.title === '판단을 골라 주세요');
    assert.equal(notice?.link, `/admin/chats/${chat.id}`, '휴대폰 알림을 누르면 그 대화로');

    // 없는 안은 고르지 못한다
    assert.equal(
      (
        await api.request('POST', `/api/approvals/${stopped.approval_id}/decide`, owner, {
          version: shown.version,
          decision: 'approve',
          choice: 3,
        })
      ).status,
      422,
    );
    ok(
      await api.request('POST', `/api/approvals/${stopped.approval_id}/decide`, owner, {
        version: shown.version,
        decision: 'approve',
        choice: 1,
      }),
    );
    const back = await taskOf(job.task.id);
    assert.equal(back.status, 'queued');
    assert.deepEqual(back.payload.decided, {
      text: '방문 시각',
      chosen: '토요일 2시',
      picked: '일요일 11시',
      note: null,
      lapsed: false,
    });
    const again = await turnOf(chat.id);
    assert.equal(again.task.payload.decided.picked, '일요일 11시');
  });

  test('끝에서만(end): 확인 필요 판단도 멈추지 않지만 되돌리기 어려운 판단은 기한 없이 멈춘다. 고쳐 말하면 그 말이 간다', async () => {
    const bad = await api.request('POST', '/api/chats', owner, {
      requestId: randomUUID(),
      message: '결제까지',
    });
    const id = (bad.json() as Json).id;
    const { chat: now } = ok(await api.get(`/api/chats/${id}`, owner));
    assert.equal(
      (
        await api.request('PATCH', `/api/chats/${id}`, owner, {
          version: now.version,
          model: null,
          effort: null,
          stop_mode: 'sometimes',
        })
      ).status,
      400,
    );

    const { job } = await openChat('항공권 결제까지 해 줘', 'end');
    const plain = await tool(job.run_token, 'post_update', {
      kind: 'decision',
      text: '경유편',
      decision: { ...ASK, confirm: 'direction' },
    });
    assert.equal(plain.waiting, undefined);
    const stopped = await tool(job.run_token, 'post_update', {
      kind: 'decision',
      text: '결제 카드',
      decision: { ...ASK, confirm: 'irreversible', wait_minutes: 5 },
    });
    assert.equal(stopped.waiting, 'approval');
    assert.equal(stopped.expires_at, null, '되돌리기 어려운 판단은 기한이 없다');

    const shown = ok(await api.get(`/api/approvals/${stopped.approval_id}`, owner));
    ok(
      await api.request('POST', `/api/approvals/${stopped.approval_id}/decide`, owner, {
        version: shown.version,
        decision: 'revise',
        note: '결제하지 말고 장바구니까지만',
      }),
    );
    const back = await taskOf(job.task.id);
    assert.equal(back.status, 'queued');
    assert.equal(back.payload.decided.picked, null);
    assert.equal(back.payload.decided.note, '결제하지 말고 장바구니까지만');
  });

  test('모두(all): 판단마다 멈추고, 기한이 지나면 서버가 추천안으로 정해 일을 잇는다', async () => {
    const { job } = await openChat('글 써 줘', 'all');
    const stopped = await tool(job.run_token, 'post_update', {
      kind: 'decision',
      text: '글의 길이',
      decision: ASK,
    });
    assert.equal(stopped.waiting, 'approval');
    await db.sql`
      UPDATE task.approvals SET expires_at = now() - interval '1 minute' WHERE id = ${stopped.approval_id}`;
    await api.service(DecisionLapseJob).run(new Date());
    const [approval] = await db.sql`
      SELECT status, agent_decided, note FROM task.approvals WHERE id = ${stopped.approval_id}`;
    assert.deepEqual([approval?.status, approval?.agent_decided], ['approved', true]);
    const back = await taskOf(job.task.id);
    assert.equal(back.status, 'queued');
    assert.equal(back.payload.decided.picked, '토요일 2시');
    assert.equal(back.payload.decided.lapsed, true);
    assert.equal(back.payload.decided.note, null);
  });
});
