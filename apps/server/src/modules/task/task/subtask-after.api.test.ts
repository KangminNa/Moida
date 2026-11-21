import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, type TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';

// 순서가 있는 위임 (D2 after, 2026-11-21): 팀장이 한 번에 맡기며 뒤 일의 after에 앞 일을 적으면, 서버가 앞 일이 끝났을 때
// 뒤 일을 만들고 앞 결과 글을 넘긴다 (팀장이 단계마다 다시 뜨지 않는다). 앞 일이 실패하면 뒤 일은 시작하지 않고 팀장이 깬다.
// 비공개를 읽는 팀원의 결과는 브라우저 담당에게 넘기지 못한다.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let runner: string;
let db: Database;
let worker: OutboxWorker;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function tool(token: string, name: string, args: Json = {}) {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as {
    isError?: boolean;
    content: { text: string }[];
    structuredContent?: Json;
  };
  return result.isError
    ? { ok: false, body: JSON.parse(result.content[0]?.text ?? '{}') as Json }
    : { ok: true, body: result.structuredContent ?? {} };
}

async function drain(): Promise<void> {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

const newAgent = async (name: string, more: Json = {}) =>
  ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `${name} ${randomUUID().slice(0, 6)}`,
      tool: 'claude',
      scopes: ['read_public', 'write'],
      approvalActions: [],
      ...more,
    }),
    201,
  );

const getTask = async (id: unknown) => ok(await api.get(`/api/tasks/${id}`, owner));

/** 대기열의 일을 모두 빌려 에이전트 id → 일로 */
async function take(): Promise<Map<string, Json>> {
  const jobs = new Map<string, Json>();
  for (let i = 0; i < 5; i++) {
    const { body } = await tool(runner, 'next_jobs');
    const got = body.jobs as Json[];
    if (got.length === 0) break;
    for (const job of got) jobs.set(String((job.agent as Json).id), job);
  }
  return jobs;
}

const order = (agent: Json, requestId: string, more: Json = {}) => ({
  request_id: requestId,
  to_agent_id: agent.id,
  title: `${agent.name}의 일`,
  instruction: '맡은 부분을 해 주세요',
  ...more,
});

const submit = (taskId: unknown, status: string, text: string) =>
  tool(runner, 'submit_result', {
    task_id: taskId,
    request_id: randomUUID(),
    status,
    ...(status === 'done' ? { result: { text } } : { error: text }),
  });

/** 팀장 하나와 팀원들, 팀장의 일을 빌린다 */
async function team(members: Json[]) {
  const lead = await newAgent('팀장');
  const made = [];
  for (const m of members)
    made.push(await newAgent(String(m.name), { reportsTo: lead.id, ...(m.more as Json) }));
  const parent = ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: lead.id,
      kind: 'general',
      title: '순서대로 하기',
      instruction: '조사한 뒤 정리해 주세요',
    }),
    201,
  );
  const job = (await take()).get(String(lead.id)) as Json;
  return { lead, members: made, parent, token: String(job.run_token) };
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '순서', siteUrl: api.baseUrl, version });
  runner = await api.connectDevice(owner, 'after-runner');
  const { devices } = ok(await api.get('/api/devices', owner)) as {
    devices: { id: string; name: string; scopes: string[]; version: number }[];
  };
  const device = devices.find((d) => d.name === 'after-runner');
  ok(
    await api.request('PATCH', `/api/devices/${device?.id}`, owner, {
      scopes: [...(device?.scopes ?? []), 'run'],
      version: device?.version,
    }),
  );
});
after(() => api.close());

describe('앞 단계 뒤에 시작', () => {
  test('앞 일만 먼저 돌고, 끝나면 서버가 뒤 일을 만들어 앞 결과를 넘긴다. 팀장은 마지막에 한 번 깬다', async () => {
    const { lead, members, parent, token } = await team([{ name: '조사' }, { name: '정리' }]);
    const [research, write] = members as [Json, Json];
    const res = await tool(token, 'delegate_task', {
      subtasks: [order(research, 'r1'), order(write, 'w1', { after: ['r1'] })],
    });
    assert.equal(res.ok, true, JSON.stringify(res.body));
    assert.equal((res.body.subtasks as Json[]).length, 1, '바로 만든 것은 앞 일 하나');

    const first = await take();
    assert.deepEqual([...first.keys()], [String(research.id)], '뒤 일은 아직 없다');
    const researchJob = first.get(String(research.id)) as Json;
    assert.equal(
      (await submit((researchJob.task as Json).id, 'done', '후보 셋: 가 · 나 · 다')).ok,
      true,
    );
    await drain();
    assert.equal(
      (await getTask(parent.id)).status,
      'waiting',
      '뒤 일이 남아 팀장은 그대로 기다린다',
    );

    const second = await take();
    const writeJob = second.get(String(write.id)) as Json;
    assert.ok(writeJob, '앞 일이 끝나 뒤 일이 생겼다');
    const handed = ((writeJob.task as Json).payload as Json).afterResults as Json[];
    assert.equal(handed.length, 1);
    assert.equal(handed[0]?.text, '후보 셋: 가 · 나 · 다');
    assert.equal(handed[0]?.taskId, (researchJob.task as Json).id);
    const [row] = await db.sql<{ payload: Json }[]>`
      SELECT payload FROM task.tasks WHERE id = ${String(parent.id)}`;
    assert.equal(row?.payload.afterOrders, undefined, '시작한 것은 지운다');

    assert.equal((await submit((writeJob.task as Json).id, 'done', '정리한 글')).ok, true);
    await drain();
    const woken = (await take()).get(String(lead.id)) as Json;
    assert.equal(woken.wake, 'all');
    assert.equal((woken.subtask_results as Json[]).length, 2);
  });

  test('앞 일이 실패하면 뒤 일은 시작하지 않고 팀장이 바로 깬다', async () => {
    const { lead, members, parent, token } = await team([{ name: '조사' }, { name: '정리' }]);
    const [research, write] = members as [Json, Json];
    const res = await tool(token, 'delegate_task', {
      subtasks: [order(research, 'r1'), order(write, 'w1', { after: ['r1'] })],
    });
    assert.equal(res.ok, true, JSON.stringify(res.body));
    const job = (await take()).get(String(research.id)) as Json;
    assert.equal((await submit((job.task as Json).id, 'failed', '자료가 없어요')).ok, true);
    await drain();
    assert.equal((await getTask(parent.id)).status, 'queued');
    const jobs = await take();
    assert.deepEqual([...jobs.keys()], [String(lead.id)], '뒤 일은 만들지 않았다');
    const [count] = await db.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM task.tasks WHERE parent_id = ${String(parent.id)}`;
    assert.equal(count?.n, 1);
  });
});

describe('거절', () => {
  test('after에 같은 호출의 앞 일이 아닌 것을 적으면 아무것도 만들지 않는다', async () => {
    const { members, parent, token } = await team([{ name: '조사' }, { name: '정리' }]);
    const [research, write] = members as [Json, Json];
    const res = await tool(token, 'delegate_task', {
      subtasks: [order(research, 'r1', { after: ['w1'] }), order(write, 'w1')],
    });
    assert.equal(res.ok, false);
    assert.match(JSON.stringify(res.body), /앞에 적은 request_id만/);
    const [count] = await db.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM task.tasks WHERE parent_id = ${String(parent.id)}`;
    assert.equal(count?.n, 0);
  });

  test('비공개를 읽는 팀원의 결과는 브라우저 담당에게 넘기지 못한다', async (t) => {
    const { members, token } = await team([
      { name: '정리' },
      { name: '브라우저', more: { scopes: ['read_public', 'browse'] } },
    ]);
    const [write, browser] = members as [Json, Json];
    ok(await api.request('POST', '/api/plugins/browser-tabs/enable', owner));
    t.after(() => api.request('POST', '/api/plugins/browser-tabs/disable', owner));
    const res = await tool(token, 'delegate_task', {
      subtasks: [order(write, 'w1'), order(browser, 'b1', { kind: 'browse', after: ['w1'] })],
    });
    assert.equal(res.ok, false);
    assert.match(JSON.stringify(res.body), /비공개를 읽는 팀원의 결과를 받지 못해요/);
  });
});
