import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, type TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';

// 검증 루프 (L2 verify, 2026-11-27): 대표가 verify로 맡긴 하위 작업이 끝나면 서버가 다른 일꾼에게 검증 일을 열고,
// 판정이 fix면 같은 일꾼에게 고칠 것을 들려 다시 맡긴다. 대표는 루프가 끝난 뒤 한 번 깬다.

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

const newAgent = async (name: string) =>
  ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `${name} ${randomUUID().slice(0, 6)}`,
      tool: 'claude',
      approvalActions: [],
    }),
    201,
  );

/** 끝나지 않은 일을 모두 닫는다 (앞 테스트 · 앞 파일이 남긴 일, 대표를 만든 첫 대화의 회차) */
const closeOpen = async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
};

/** 대표 (O-2): 첫 대화에서 생긴다. 같은 DB를 쓰는 앞 파일이 이미 만들었을 수 있다 */
async function leadAgent(): Promise<Json> {
  const found = ok(await api.get('/api/agents/lead', owner)).lead as Json | null;
  if (found) return found;
  ok(
    await api.request('POST', '/api/chats', owner, {
      requestId: randomUUID(),
      message: '대표를 만드는 첫 대화',
    }),
    201,
  );
  await closeOpen();
  return ok(await api.get('/api/agents/lead', owner)).lead as Json;
}

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

/** 대표와 일꾼들, 대표의 일을 빌린다 */
async function team(names: string[]) {
  const lead = await leadAgent();
  const made = [];
  for (const name of names) made.push(await newAgent(name));
  const parent = ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: lead.id,
      kind: 'general',
      title: '검증받기',
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
  await api.request('PUT', '/api/space', owner, { name: '검증', siteUrl: api.baseUrl, version });
  runner = await api.connectDevice(owner, 'verify-runner');
  const { devices } = ok(await api.get('/api/devices', owner)) as {
    devices: { id: string; name: string; scopes: string[]; version: number }[];
  };
  const device = devices.find((d) => d.name === 'verify-runner');
  ok(
    await api.request('PATCH', `/api/devices/${device?.id}`, owner, {
      scopes: [...(device?.scopes ?? []), 'run'],
      version: device?.version,
    }),
  );
});
after(async () => {
  await closeOpen(); // 뒤의 테스트 파일이 이 파일의 일을 빌리지 않게
  await api.close();
});

/** 이 테스트의 일만 빌려 가게 앞 테스트가 남긴 일을 치운다 */
beforeEach(closeOpen);

/** 빌린 일 가운데 제목이 이렇게 시작하는 것 (검증 일은 맡은 일꾼이 아닌 아무 일꾼에게 갈 수 있다) */
const titled = (jobs: Map<string, Json>, prefix: string) =>
  [...jobs.values()].find((j) => String((j.task as Json).title).startsWith(prefix));

describe('검증 루프', () => {
  test('끝나면 다른 일꾼이 검증하고, fix면 같은 일꾼이 고친다. pass가 나면 대표가 한 번 깬다', async () => {
    const { members, parent, token } = await team(['조사', '검증']);
    const [research] = members as [Json, Json];
    const res = await tool(token, 'delegate_task', {
      subtasks: [order(research, 'v1', { verify: true, deliver: '후보 셋, 각 출처 주소' })],
    });
    assert.equal(res.ok, true, JSON.stringify(res.body));

    const first = (await take()).get(String(research.id)) as Json;
    assert.equal(((first.task as Json).payload as Json).verify, true);
    await submit((first.task as Json).id, 'done', '후보 셋: 가 · 나 · 다');
    await drain();
    assert.equal(
      (await getTask(parent.id)).status,
      'waiting',
      '검증 일이 남아 대표는 아직 자고 있다',
    );

    const check = titled(await take(), '검증: ') as Json;
    assert.ok(check, '검증 일이 생긴다');
    assert.notEqual((check.agent as Json).id, research.id, '맡은 일꾼이 아닌 쪽이 검증한다');
    assert.match(String((check.task as Json).title), /^검증: /);
    const seed = (check.task as Json).payload as Json;
    assert.equal(seed.verifyOf, (first.task as Json).id);
    assert.equal((seed.check as Json).result, '후보 셋: 가 · 나 · 다');
    assert.equal((seed.check as Json).deliver, '후보 셋, 각 출처 주소');
    await submit(
      (check.task as Json).id,
      'done',
      JSON.stringify({
        verdict: 'fix',
        summary: '출처가 없다',
        checklist: [{ item: '각 출처 주소', score: 2 }],
        fixes: ['후보마다 출처 주소를 단다'],
      }),
    );
    await drain();

    const retry = (await take()).get(String(research.id)) as Json;
    assert.ok(retry, '같은 일꾼에게 고치기 일');
    assert.match(String((retry.task as Json).title), /^고치기: /);
    const fixSeed = (retry.task as Json).payload as Json;
    assert.deepEqual((fixSeed.fixNote as Json).fixes, ['후보마다 출처 주소를 단다']);
    assert.deepEqual([fixSeed.round, fixSeed.verify], [2, true]);
    await submit((retry.task as Json).id, 'done', '후보 셋: 가(a.com) · 나(b.com) · 다(c.com)');
    await drain();

    const recheck = titled(await take(), '검증: ') as Json;
    assert.ok(recheck, '고친 결과를 다시 검증');
    await submit(
      (recheck.task as Json).id,
      'done',
      JSON.stringify({ verdict: 'pass', checklist: [{ item: '각 출처 주소', score: 5 }] }),
    );
    await drain();
    assert.equal((await getTask(parent.id)).status, 'queued', '루프가 끝나야 대표가 깬다');
    const woke = (await take()).values().next().value as Json;
    const titles = (woke.subtask_results as Json[]).map((r) => String(r.title));
    assert.equal(titles.length, 4, '맡긴 일 · 검증 · 고치기 · 다시 검증이 모두 실려 온다');
  });

  test('검증할 다른 일꾼이 없으면 검증 없이 대표가 바로 깬다', async () => {
    const { lead, parent, token } = await team(['혼자']);
    const solo = (ok(await api.get('/api/agents', owner)).agents as Json[]).filter(
      (a) => a.id !== lead.id && String(a.name).startsWith('혼자'),
    );
    // 앞 테스트의 일꾼이 남아 있으면 검증자가 생긴다: 잠깐 지운 것으로 두고 끝나면 되돌린다 (뒤 파일에 남기지 않게)
    const hidden = (ok(await api.get('/api/agents', owner)).agents as Json[])
      .filter((a) => a.id !== lead.id && !solo.some((s) => s.id === a.id))
      .map((a) => String(a.id));
    await db.sql`UPDATE task.agents SET deleted_at = now() WHERE id = ANY(${hidden})`;
    const res = await tool(token, 'delegate_task', {
      subtasks: [order(solo[0] as Json, 's1', { verify: true })],
    });
    assert.equal(res.ok, true, JSON.stringify(res.body));
    const job = (await take()).get(String((solo[0] as Json).id)) as Json;
    await submit((job.task as Json).id, 'done', '끝');
    await drain();
    try {
      assert.equal((await getTask(parent.id)).status, 'queued');
    } finally {
      await db.sql`UPDATE task.agents SET deleted_at = NULL WHERE id = ANY(${hidden})`;
    }
  });
});
