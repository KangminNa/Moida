import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, type TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';
import { SubtaskWaitJob } from './subtask-wait.job';

// 팀원 기다리기 (2026-11-19 사용자 요청 "팀원 기다리는 게 너무 오래 걸린다"): 위 작업은 하위 작업을 모두 기다리지 않는다.
// 실패 · 기한 · 관리자 재촉으로 먼저 깨고, 깬 일에는 끝나지 않은 일이 상태 · 맡긴 때와 함께 온다. 더 기다리기(wait_subtasks),
// 마무리하면 끝나지 않은 하위 작업은 취소(승인을 기다리는 일은 그대로), 대화의 일은 대기열에서 먼저.

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

/** 대기열의 일을 하나씩 빌려 에이전트 id → 일로 */
async function take(count: number): Promise<Map<string, Json>> {
  const jobs = new Map<string, Json>();
  for (let i = 0; i < count; i++) {
    const { body } = await tool(runner, 'next_jobs');
    for (const job of body.jobs as Json[]) jobs.set(String((job.agent as Json).id), job);
  }
  assert.equal(jobs.size, count);
  return jobs;
}

const order = (agent: Json) => ({
  request_id: randomUUID(),
  to_agent_id: agent.id,
  title: `${agent.name}의 일`,
  instruction: '맡은 부분을 해 주세요',
});

/** 팀장과 팀원 셋, 팀장의 일 하나를 빌려 둘에게 맡긴다 (기한 minutes) */
async function delegated(minutes?: number) {
  const lead = await newAgent('팀장');
  const members = [];
  for (const name of ['조사', '정리', '그림'])
    members.push(await newAgent(name, { reportsTo: lead.id }));
  const parent = ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: lead.id,
      kind: 'general',
      title: '나눠서 하기',
      instruction: '팀에 나눠 맡겨 주세요',
    }),
    201,
  );
  const job = (await take(1)).get(String(lead.id)) as Json;
  const res = await tool(String(job.run_token), 'delegate_task', {
    subtasks: [order(members[0] as Json), order(members[1] as Json)],
    ...(minutes ? { wait_minutes: minutes } : {}),
  });
  assert.equal(res.ok, true, JSON.stringify(res.body));
  const children = await take(2);
  return { lead, members, parent, children };
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, {
    name: '기다리기',
    siteUrl: api.baseUrl,
    version,
  });
  runner = await api.connectDevice(owner, 'wait-runner');
  const { devices } = ok(await api.get('/api/devices', owner)) as {
    devices: { id: string; name: string; scopes: string[]; version: number }[];
  };
  const device = devices.find((d) => d.name === 'wait-runner');
  ok(
    await api.request('PATCH', `/api/devices/${device?.id}`, owner, {
      scopes: [...(device?.scopes ?? []), 'run'],
      version: device?.version,
    }),
  );
});
after(() => api.close());

describe('먼저 깨우기', () => {
  test('하위 작업 하나가 실패하면 형제를 기다리지 않고 깨우고, 끝나지 않은 일은 상태 · 맡긴 때와 함께 온다', async () => {
    const { lead, members, parent, children } = await delegated();
    const waiting = await getTask(parent.id);
    assert.equal(waiting.status, 'waiting');
    const failing = children.get(String((members[0] as Json).id)) as Json;
    const res = await tool(runner, 'submit_result', {
      task_id: (failing.task as Json).id,
      request_id: randomUUID(),
      status: 'failed',
      error: '자료를 찾지 못했어요',
    });
    assert.equal(res.ok, true, JSON.stringify(res.body));
    await drain();
    assert.equal((await getTask(parent.id)).status, 'queued', '형제를 기다리지 않는다');

    const woken = (await take(1)).get(String(lead.id)) as Json;
    assert.equal(woken.wake, 'failed');
    const results = woken.subtask_results as Json[];
    const failed = results.find((r) => r.status === 'failed') as Json;
    assert.equal(failed.error, '자료를 찾지 못했어요');
    const open = results.find((r) => r.status === 'running') as Json;
    assert.ok(open, '끝나지 않은 일도 실린다');
    assert.equal(open.summary, null);
    assert.ok(Date.parse(String(open.since)) > 0, '맡긴 때');
  });

  test('기한이 지나면 다 끝나지 않아도 깨운다 (마감 작업). 기한 전에는 그대로', async () => {
    const { lead, parent } = await delegated(5);
    const due = api.service(SubtaskWaitJob);
    await due.run(new Date(Date.now() + 4 * 60_000));
    assert.equal((await getTask(parent.id)).status, 'waiting', '기한 전');
    await due.run(new Date(Date.now() + 6 * 60_000));
    assert.equal((await getTask(parent.id)).status, 'queued');
    const woken = (await take(1)).get(String(lead.id)) as Json;
    assert.equal(woken.wake, 'deadline');
    assert.equal((woken.subtask_results as Json[]).length, 2);
  });
});

describe('깬 뒤에 정하기', () => {
  test('wait_subtasks: 골라서 취소하고 나머지를 기다린다 · 남은 것을 모두 취소하면 마무리하라고 한다 · 라운드를 쓴다', async () => {
    const { lead, members, parent, children } = await delegated(1);
    await api.service(SubtaskWaitJob).run(new Date(Date.now() + 2 * 60_000));
    const woken = (await take(1)).get(String(lead.id)) as Json;
    const token = String(woken.run_token);
    const [first, second] = [0, 1].map(
      (i) => ((children.get(String((members[i] as Json).id)) as Json).task as Json).id,
    );

    const all = await tool(token, 'wait_subtasks', { cancel: [first, second] });
    assert.equal(all.ok, false);
    assert.match(JSON.stringify(all.body), /지금까지의 결과로 마무리해요/);
    assert.equal((await getTask(first)).status, 'running', '거절하면 아무것도 바꾸지 않는다');

    const some = await tool(token, 'wait_subtasks', { cancel: [first], minutes: 10 });
    assert.equal(some.ok, true, JSON.stringify(some.body));
    assert.equal(some.body.waiting, 'subtasks');
    assert.deepEqual(
      (some.body.subtasks as Json[]).map((s) => s.task_id),
      [second],
    );
    assert.equal((await getTask(first)).status, 'cancelled');
    const parked = await getTask(parent.id);
    assert.equal(parked.status, 'waiting');
    assert.equal(
      (
        await db.sql<
          { rounds: number }[]
        >`SELECT rounds FROM task.tasks WHERE id = ${String(parent.id)}`
      )[0]?.rounds,
      2,
      '맡기기 한 번 + 더 기다리기 한 번',
    );
  });

  test('마무리하면 끝나지 않은 하위 작업은 취소하고, 승인을 기다리는 일은 그대로 둔다', async () => {
    const { lead, members, parent, children } = await delegated(1);
    const [first, second] = [0, 1].map(
      (i) => ((children.get(String((members[i] as Json).id)) as Json).task as Json).id,
    );
    // 둘째 팀원은 승인을 기다리는 중 (결재를 올린 뒤의 상태)
    await db.sql`UPDATE task.tasks SET status = 'waiting', wait_reason = 'approval' WHERE id = ${String(second)}`;
    await api.service(SubtaskWaitJob).run(new Date(Date.now() + 2 * 60_000));
    (await take(1)).get(String(lead.id));
    const done = await tool(runner, 'submit_result', {
      task_id: parent.id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '조사는 빼고 지금까지로 답해요' },
    });
    assert.equal(done.ok, true, JSON.stringify(done.body));
    assert.equal((await getTask(first)).status, 'cancelled');
    assert.equal((await getTask(second)).status, 'waiting', '승인은 관리자가 정한다');
  });
});

describe('팀원 돕기 (2026-11-20)', () => {
  test('ask_help: 팀원이 나눌 부분을 적으면 기다리던 팀장을 먼저 깨우고, 팀장은 끝나지 않은 일의 진행 기록과 도움 요청 줄을 받는다', async () => {
    const { lead, members, parent, children } = await delegated(30);
    const [slow, quick] = [0, 1].map(
      (i) => children.get(String((members[i] as Json).id)) as Json,
    ) as [Json, Json];
    const slowId = String((slow.task as Json).id);
    const progress = await tool(runner, 'report_progress', {
      task_id: slowId,
      events: [
        { kind: 'write', body: '자료 10개 중 4개 읽음' },
        { kind: 'read', body: '' },
      ],
    });
    assert.equal(progress.ok, true, JSON.stringify(progress.body));
    const asked = await tool(String(slow.run_token), 'ask_help', { part: '6~10번 자료 요약' });
    assert.equal(asked.ok, true, JSON.stringify(asked.body));
    assert.deepEqual(asked.body, { asked: true, lead_woken: true });
    assert.equal((await getTask(parent.id)).status, 'queued', '팀장을 먼저 깨운다');
    assert.equal((await getTask(slowId)).status, 'running', '요청한 팀원은 계속 일한다');

    const woken = (await take(1)).get(String(lead.id)) as Json;
    assert.equal(woken.wake, 'help');
    const results = woken.subtask_results as Json[];
    const open = results.find((r) => r.task_id === slowId) as Json;
    assert.deepEqual(open.progress, ['자료 10개 중 4개 읽음', '도움 요청: 6~10번 자료 요약']);
    const other = results.find((r) => r.task_id === (quick.task as Json).id) as Json;
    assert.deepEqual(other.progress, [], '기록이 없으면 빈 목록');

    // 팀장이 이미 깼으면 깨우지 않고 기록만 남긴다. 일 하나에 두 번까지
    const again = await tool(String(slow.run_token), 'ask_help', { part: '그림 고르기' });
    assert.deepEqual(again.body, { asked: true, lead_woken: false });
    const third = await tool(String(slow.run_token), 'ask_help', { part: '하나 더' });
    assert.equal(third.ok, false);
    assert.match(JSON.stringify(third.body), /2번까지/);
  });

  test('ask_help는 팀장이 맡긴 일에서만: 맨 위 일은 직접 끝내거나 아래 팀에 맡긴다', async () => {
    const solo = await newAgent('혼자');
    ok(
      await api.request('POST', '/api/tasks', owner, {
        requestId: randomUUID(),
        agentId: solo.id,
        kind: 'general',
        title: '혼자 하기',
        instruction: '직접 해 주세요',
      }),
      201,
    );
    const job = (await take(1)).get(String(solo.id)) as Json;
    const refused = await tool(String(job.run_token), 'ask_help', { part: '절반' });
    assert.equal(refused.ok, false);
    assert.match(JSON.stringify(refused.body), /팀장이 맡긴 일에서만/);
  });
});

describe('지금까지로 답하기 (관리자)', () => {
  test('기다리는 작업을 바로 깨우고, 그 뒤로는 더 맡기거나 기다리지 못한다. 방문자는 못 하고, 끝난 작업은 409', async () => {
    const { lead, members, parent } = await delegated(30);
    const visitor = await api.request('POST', `/api/tasks/${parent.id}/hurry`);
    assert.ok([401, 403].includes(visitor.status), visitor.text);
    const hurried = ok(await api.request('POST', `/api/tasks/${parent.id}/hurry`, owner));
    assert.equal(hurried.status, 'queued');
    const woken = (await take(1)).get(String(lead.id)) as Json;
    assert.equal(woken.wake, 'owner');
    const token = String(woken.run_token);
    for (const [name, args] of [
      ['wait_subtasks', {}],
      ['delegate_task', { subtasks: [order(members[2] as Json)] }],
    ] as const) {
      const refused = await tool(token, name, args);
      assert.equal(refused.ok, false, name);
      assert.match(JSON.stringify(refused.body), /지금까지의 결과로 답해 달라고 했어요/);
    }
    await tool(runner, 'submit_result', {
      task_id: parent.id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '지금까지의 결과' },
    });
    const late = await api.request('POST', `/api/tasks/${parent.id}/hurry`, owner);
    assert.equal(late.status, 409, late.text);
  });
});

describe('대화의 일 먼저', () => {
  test('대화의 회차는 우선순위 10이고, 맡긴 하위 작업도 물려받는다', async () => {
    const chat = ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        message: '이번 주 글감을 모아 주세요',
      }),
      201,
    );
    const [turn] = await db.sql<{ priority: number }[]>`
      SELECT priority FROM task.tasks WHERE request_id LIKE ${`chat:${String(chat.id)}:%`}`;
    assert.equal(turn?.priority, 10);
  });
});
