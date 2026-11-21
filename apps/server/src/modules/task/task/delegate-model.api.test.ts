import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, type TestUser } from '../../../testing/api-client';
import { Database } from '../../platform';

// 모델 상한 (2026-11-19 사용자 결정): 관리자가 정한 모델이 상한이고, 그 아래 팀의 모델은 맡기는 쪽이 일마다 상한 이하에서
// 고른다 (delegate_task의 model, 승인 없음). 고른 모델 · 낮춘 모델은 하위 작업의 payload.runtime.model에 실린다.
// Fable 계열(fable · claude-fable-* · best)은 어디서도 받지 않는다.
// 맡기는 쪽은 대표 하나다 (2026-11-21 팀 없는 같은 일꾼): 일꾼은 다시 맡기지 못해 상한은 대표의 일의 모델 한 층이다.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let runner: string;
let db: Database;

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

const newAgent = (name: string, more: Json = {}) =>
  api.request('POST', '/api/agents', owner, {
    requestId: randomUUID(),
    name,
    tool: 'claude',
    approvalActions: [],
    ...more,
  });

/** 끝나지 않은 일을 모두 닫는다 (앞 파일이 남긴 일, 대표를 만든 첫 대화의 회차) */
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

/** 대기열의 일을 하나씩 모두 빌린다 (에이전트 id → 일) */
async function takeAll(count: number): Promise<Map<string, Json>> {
  const jobs = new Map<string, Json>();
  for (let i = 0; i < count; i++) {
    const { ok: done, body } = await tool(runner, 'next_jobs');
    assert.equal(done, true, JSON.stringify(body));
    for (const job of body.jobs as Json[]) jobs.set(String((job.agent as Json).id), job);
  }
  assert.equal(jobs.size, count);
  return jobs;
}

const order = (agent: Json, more: Json = {}) => ({
  request_id: randomUUID(),
  to_agent_id: agent.id,
  title: `${agent.name}의 일`,
  instruction: '맡은 부분을 해 주세요',
  ...more,
});

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '모델', siteUrl: api.baseUrl, version });
  runner = await api.connectDevice(owner, 'model-runner');
  const { devices } = ok(await api.get('/api/devices', owner)) as {
    devices: { id: string; name: string; scopes: string[]; version: number }[];
  };
  const device = devices.find((d) => d.name === 'model-runner');
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

/** 이 테스트의 일만 빌려 가게 앞 테스트 · 앞 파일이 남긴 일을 치운다 */
beforeEach(closeOpen);

describe('Fable은 쓰지 않는다', () => {
  test('에이전트의 모델에 fable · claude-fable-* · best는 422', async () => {
    for (const model of ['fable', 'claude-fable-5-2', 'FABLE', 'best']) {
      const res = await newAgent(`페이블-${model}`, { model });
      assert.equal(res.status, 422, `${model} ${res.text}`);
      assert.match(res.text, /Fable 모델은 쓰지 않아요/);
    }
    ok(await newAgent('소네트', { model: 'sonnet' }), 201);
    ok(await newAgent('전체 id', { model: 'claude-opus-5-5' }), 201);
  });
});

describe('맡길 때 모델 고르기 (상한 = 맡기는 일의 모델)', () => {
  test('상한 이하에서 고르고, 고르지 않으면 일꾼의 설정을 상한으로 낮춘다. 일꾼은 다시 맡기지 못한다', async () => {
    const lead = await leadAgent();
    const quick = ok(await newAgent('빠른 일꾼'), 201);
    const small = ok(await newAgent('작은 일꾼', { model: 'haiku' }), 201);
    const big = ok(await newAgent('큰 일꾼', { model: 'opus' }), 201);
    const under = ok(await newAgent('다른 일꾼'), 201);
    // 상한은 맡기는 일의 모델: 대화가 정한 모델처럼 일에 실린 모델(payload.runtime)이 대표의 설정보다 먼저다
    ok(
      await api.request('POST', '/api/tasks', owner, {
        requestId: randomUUID(),
        agentId: lead.id,
        kind: 'general',
        title: '나눠서 하기',
        instruction: '일꾼에게 나눠 맡겨 주세요',
        payload: { runtime: { model: 'sonnet' } },
      }),
      201,
    );
    const job = (await takeAll(1)).get(String(lead.id)) as Json;
    assert.equal((job.agent as Json).model, 'sonnet');
    const token = String(job.run_token);

    // 상한(sonnet)보다 높게 고르면 거절 · 목록 밖의 이름도 거절
    const tooHigh = await tool(token, 'delegate_task', {
      subtasks: [order(quick, { model: 'opus' })],
    });
    assert.equal(tooHigh.ok, false);
    assert.match(JSON.stringify(tooHigh.body), /sonnet보다 높은 모델로 맡길 수 없어요/);
    const unknown = await tool(token, 'delegate_task', {
      subtasks: [order(quick, { model: 'fable' })],
    });
    assert.equal(unknown.ok, false);

    const delegated = await tool(token, 'delegate_task', {
      subtasks: [order(quick, { model: 'haiku' }), order(small), order(big)],
    });
    assert.equal(delegated.ok, true, JSON.stringify(delegated.body));
    const children = await takeAll(3);
    const modelOf = (agent: Json) => ((children.get(String(agent.id)) as Json).agent as Json).model;
    assert.equal(modelOf(quick), 'haiku', '고른 모델');
    assert.equal(modelOf(small), 'haiku', '설정이 상한보다 낮으면 그대로');
    assert.equal(modelOf(big), 'sonnet', '설정(opus)이 상한보다 높으면 상한으로');

    // 맡기기는 대표만 (2026-11-21): 낮춘 모델을 받은 일꾼도 다른 일꾼에게 다시 맡기지 못한다
    const bigToken = String((children.get(String(big.id)) as Json).run_token);
    const again = await tool(bigToken, 'delegate_task', { subtasks: [order(under)] });
    assert.equal(again.ok, false);
    assert.equal(again.body.code, 'forbidden');
  });
});
