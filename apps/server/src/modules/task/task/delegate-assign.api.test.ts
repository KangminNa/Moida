import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, type TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker, SystemActor } from '../../platform';
import { ChatUpdateService } from '../chat/chat-update.service';

// D3 (2026-11-28): delegate_task의 to_agent_id를 비우면 서버가 맡을 수 있는 일꾼 가운데 지금 쥔 일(대기 · 실행)이
// 가장 적은 일꾼을 고른다. 대화의 일이 하위 작업을 기다리기 시작하면 나눠 맡긴 계획이 판단 소식(decision.planned)으로 남는다

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 테스트 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let worker: OutboxWorker;
let runner: string;
let busy: Json;
let idle: Json;
/** 이 파일 동안 멈춰 둔 다른 일꾼 (끝나면 되돌린다) */
let paused: string[] = [];

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
  const result = res.json().result as Json;
  return result.isError
    ? { ok: false, text: JSON.stringify(result.content) }
    : { ok: true, ...(result.structuredContent ?? {}) };
}

const newWorker = async (name: string) =>
  ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `${name} ${randomUUID().slice(0, 6)}`,
      tool: 'claude',
    }),
    201,
  );

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '나누기', siteUrl: api.baseUrl, version });
  runner = await api.connectDevice(owner, 'assign-runner');
  const { devices } = ok(await api.get('/api/devices', owner)) as { devices: Json[] };
  const device = devices.find((d) => d.name === 'assign-runner') as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...device.scopes, 'run'],
      version: device.version,
    }),
  );
  busy = await newWorker('바쁜 일꾼');
  idle = await newWorker('한가한 일꾼');
  // 앞 파일이 만든 일꾼은 이 파일 동안 멈춘다: 두 일꾼 사이에서만 고르게
  paused = (
    await db.sql`
      UPDATE task.agents SET status = 'paused'
      WHERE NOT lead AND deleted_at IS NULL AND status <> 'paused' AND id NOT IN (${busy.id}, ${idle.id})
      RETURNING id`
  ).map((r) => String(r.id));
});

after(async () => {
  if (paused.length > 0)
    await db.sql`UPDATE task.agents SET status = 'active' WHERE id IN ${db.sql(paused)}`;
  await db.sql`UPDATE task.agents SET deleted_at = now() WHERE id IN (${busy.id}, ${idle.id})`;
  await api.close();
});

beforeEach(async () => {
  await drain();
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});

describe('담당 없이 맡기기 · 계획 판단 (D3)', () => {
  test('덜 바쁜 일꾼부터 고르고, 대화에 나눠 맡긴 계획이 판단으로 남는다', async () => {
    const chat = ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        message: '여행 준비를 나눠서 해 줘',
      }),
      201,
    );
    const jobs: Json[] = (await tool(runner, 'next_jobs', { limit: 5 })).jobs ?? [];
    const turn = jobs.find((j) => j.task.payload.chat?.chatId === chat.id) as Json;
    assert.ok(turn, '회차를 빌리지 못했다');
    // 바쁜 일꾼은 대기 중인 일 하나를 쥐고 있다
    ok(
      await api.request('POST', '/api/tasks', owner, {
        requestId: randomUUID(),
        agentId: busy.id,
        kind: 'general',
        title: '먼저 맡은 일',
        instruction: '기다리는 일',
      }),
      201,
    );
    const sub = (title: string, more: Json = {}) => ({
      request_id: title,
      title,
      instruction: `${title}를 해 주세요`,
      ...more,
    });
    const delegated = await tool(turn.run_token, 'delegate_task', {
      subtasks: [sub('숙소'), sub('교통'), sub('일정', { after: ['숙소'] })],
    });
    assert.equal(delegated.ok, true, delegated.text);
    const made = await db.sql`
      SELECT title, agent_id FROM task.tasks WHERE parent_id = ${turn.task.id} ORDER BY title`;
    const agentOf = (title: string) => String(made.find((t) => t.title === title)?.agent_id);
    assert.equal(agentOf('숙소'), idle.id, '쥔 일이 적은 일꾼이 먼저');
    assert.notEqual(agentOf('교통'), agentOf('숙소'), '같은 호출에서 맡긴 것도 센다');
    const [held] = await db.sql`SELECT payload FROM task.tasks WHERE id = ${turn.task.id}`;
    const later = (held as Json).payload.afterOrders[0].order;
    assert.ok([busy.id, idle.id].includes(later.to_agent_id), '앞 단계 뒤의 일도 지금 고른 일꾼');

    await drain();
    const room = ok(await api.get(`/api/chats/${chat.id}`, owner));
    const plans = room.news.filter((n: Json) => n.kind === 'decision' && n.decision?.planned);
    assert.equal(plans.length, 1, JSON.stringify(room.news));
    const [plan] = plans;
    assert.equal(plan.text, '일 3개를 나눠 맡김');
    assert.equal(plan.decision.step, '나눠 맡기기');
    assert.deepEqual(
      // 같은 때 만든 하위 작업끼리의 순서는 정해져 있지 않다
      plan.decision.plan.map((p: Json) => [p.title, p.after]).sort(),
      [
        ['교통', false],
        ['숙소', false],
        ['일정', true],
      ],
    );
    assert.match(plan.decision.chosen, new RegExp(`숙소 → ${idle.name}`));

    // 같은 이벤트를 다시 받아도 계획 판단은 하나
    await api.service(ChatUpdateService).notePlan(new SystemActor(), turn.task.id);
    await drain();
    const again = ok(await api.get(`/api/chats/${chat.id}`, owner));
    assert.equal(
      again.news.filter((n: Json) => n.kind === 'decision' && n.decision?.planned).length,
      1,
    );
  });

  test('고를 일꾼이 없으면 거절한다', async () => {
    const chat = ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        message: '혼자 해 줘',
      }),
      201,
    );
    const jobs: Json[] = (await tool(runner, 'next_jobs', { limit: 5 })).jobs ?? [];
    const turn = jobs.find((j) => j.task.payload.chat?.chatId === chat.id) as Json;
    await db.sql`UPDATE task.agents SET status = 'paused' WHERE id IN (${busy.id}, ${idle.id})`;
    try {
      const refused = await tool(turn.run_token, 'delegate_task', {
        subtasks: [{ request_id: 'a', title: '일', instruction: '해 주세요' }],
      });
      assert.equal(refused.ok, false);
      assert.match(refused.text, /맡을 수 있는 일꾼이 없어요/);
    } finally {
      await db.sql`UPDATE task.agents SET status = 'active' WHERE id IN (${busy.id}, ${idle.id})`;
    }
  });
});
