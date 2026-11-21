import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, type TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';

// 중간 판단 알림 (L1, 2026-11-21): 팀원이 post_update의 decision 칸으로 판단의 모양을 남기면 대화에 그대로 보인다.
// 관리자의 판단 바꾸기는 덧붙인 말로 가고, 팀원을 기다리는 회차는 POST api/tasks/:id/wake로 먼저 깨운다 (깬 까닭 change)

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 테스트 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let worker: OutboxWorker;
let runner: string;
let member: Json;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function drain(): Promise<void> {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

const call = (token: string, name: string, args: Json = {}) =>
  api.mcp(token, 'tools/call', { name, arguments: args });

async function tool(token: string, name: string, args: Json = {}): Promise<Json> {
  const res = await call(token, name, args);
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as { isError?: boolean; structuredContent?: Json };
  assert.ok(!result.isError, JSON.stringify(result));
  return result.structuredContent ?? {};
}

/** 도구가 거절한 글 (isError) */
async function refused(token: string, name: string, args: Json = {}): Promise<string> {
  const res = await call(token, name, args);
  const result = (res.json() as Json).result;
  assert.equal(result.isError, true, JSON.stringify(result));
  return JSON.stringify(result.content);
}

async function turnOf(chatId: string, turn: number): Promise<Json> {
  const jobs: Json[] = (await tool(runner, 'next_jobs', { limit: 5 })).jobs ?? [];
  const job = jobs.find(
    (j) => j.task.payload.chat?.chatId === chatId && j.task.payload.chat?.turn === turn,
  );
  assert.ok(job, `${turn}번째 회차가 빌려지지 않았다`);
  return job;
}

const detail = async (chatId: string) => ok(await api.get(`/api/chats/${chatId}`, owner));

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '판단', siteUrl: api.baseUrl, version });
  runner = await api.connectDevice(owner, 'decision-runner');
  const { devices } = ok(await api.get('/api/devices', owner)) as { devices: Json[] };
  const device = devices.find((d) => d.name === 'decision-runner') as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...device.scopes, 'run'],
      version: device.version,
    }),
  );
  member = ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `조사 ${randomUUID().slice(0, 6)}`,
      tool: 'claude',
      scopes: ['read_public'],
    }),
    201,
  );
});

after(async () => {
  await db.sql`UPDATE task.agents SET deleted_at = now() WHERE id = ${member.id}`;
  await api.close();
});

beforeEach(async () => {
  await drain();
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});

const DECISION = {
  chosen: '최근 3년 자료만',
  alternatives: ['최근 5년', '전체 기간'],
  why: '자료가 많아 범위를 좁힘',
  weight: 'high',
  step: '조사',
};

describe('중간 판단 알림', () => {
  test('팀원의 판단은 모양과 함께 대화에 보이고, 바꾸기는 덧붙인 말 + 기다리던 회차를 깨운다 (깬 까닭 change)', async () => {
    const chat = ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        message: '경쟁사 가격 비교해 줘',
      }),
      201,
    );
    const turn = await turnOf(chat.id, 1);
    await tool(turn.run_token, 'delegate_task', {
      subtasks: [
        {
          request_id: randomUUID(),
          to_agent_id: member.id,
          title: '조사',
          instruction: '가격 조사',
        },
      ],
    });
    const jobs: Json[] = (await tool(runner, 'next_jobs', { limit: 5 })).jobs ?? [];
    const sub = jobs.find((j) => j.task.title === '조사') as Json;
    assert.ok(sub, '팀원의 일이 빌려지지 않았다');
    // 판단 모양은 decision에만, 무게는 정해진 값만
    assert.match(
      await refused(sub.run_token, 'post_update', {
        kind: 'progress',
        text: '중간',
        decision: DECISION,
      }),
      /kind가 decision일 때만/,
    );
    assert.match(
      await refused(sub.run_token, 'post_update', {
        kind: 'decision',
        text: '조사 범위',
        decision: { ...DECISION, weight: 'urgent' },
      }),
      /무게는/,
    );
    await tool(sub.run_token, 'post_update', {
      kind: 'decision',
      text: '조사 범위',
      decision: DECISION,
    });
    await tool(sub.run_token, 'post_update', { kind: 'decision', text: '모양 없는 판단' });

    const room = await detail(chat.id);
    const said = room.news.filter((n: Json) => n.kind === 'decision');
    assert.deepEqual(
      said.map((n: Json) => [n.text, n.decision]),
      [
        ['조사 범위', DECISION],
        ['모양 없는 판단', null],
      ],
    );

    // 바꾸기: 덧붙인 말을 보내고 기다리는 회차를 깨운다
    const waiting = room.turns[0];
    assert.equal(waiting.status, 'waiting');
    ok(
      await api.request('POST', `/api/chats/${chat.id}/messages`, owner, {
        requestId: randomUUID(),
        version: room.chat.version,
        message: '판단 바꾸기 — 조사: 조사 범위 (고른 안: 최근 3년 자료만)\n→ 최근 5년으로',
      }),
      201,
    );
    assert.equal((await api.request('POST', `/api/tasks/${waiting.taskId}/wake`)).status, 403);
    const woke = ok(await api.request('POST', `/api/tasks/${waiting.taskId}/wake`, owner));
    assert.equal(woke.status, 'queued');
    assert.equal(
      (await api.request('POST', `/api/tasks/${waiting.taskId}/wake`, owner)).status,
      409,
      '기다리는 중이 아니면 깨우지 못한다',
    );
    const again = await turnOf(chat.id, 1);
    assert.equal(again.wake, 'change');
    assert.match(JSON.stringify(again.chat_updates), /판단 바꾸기/);
    // 팀원의 일은 그대로 돈다 (대표가 골라 취소한다)
    const [left] = await db.sql`SELECT status FROM task.tasks WHERE id = ${sub.task.id}`;
    assert.equal(left?.status, 'running');
  });
});
