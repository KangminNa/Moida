import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';

// 외부 도구 꽂기 (2차 7단계): /api/external-tools (관리자만), 에이전트의 허락 칸, next_jobs의 tools,
// AI의 제안(propose_tool) → 결재(task.tool.plug) → 승인이면 켜지고 제안한 에이전트에 붙는다.
// 러너는 MCP로, 관리자는 REST로 들어오고 결재의 실행은 outbox와 일꾼을 실제로 거친다. AI는 띄우지 않는다.

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let worker: OutboxWorker;
/** run 권한 기기 (러너) */
let runner: string;
/** write 권한 기기: 관리 일은 막혀야 한다 */
let writer: Readonly<Record<string, string>>;
const SECRET = 'Bearer tool-secret-123456';

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.status === 204 ? {} : res.json();
}

async function tool(token: string, name: string, args: Json = {}) {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as Json;
  return result.isError
    ? { ok: false, body: JSON.parse(result.content[0]?.text ?? '{}') as Json }
    : { ok: true, body: (result.structuredContent ?? {}) as Json };
}

async function call(token: string, name: string, args: Json = {}): Promise<Json> {
  const { ok: done, body } = await tool(token, name, args);
  assert.equal(done, true, JSON.stringify(body));
  return body;
}

const create = (body: Json) =>
  api.request('POST', '/api/external-tools', owner, { requestId: randomUUID(), ...body });
const listed = async (): Promise<Json[]> =>
  ok(await api.get('/api/external-tools', owner)).tools as Json[];
const one = async (name: string): Promise<Json | undefined> =>
  (await listed()).find((t) => t.name === name);

const agent = async (more: Json = {}) =>
  ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `도구 ${randomUUID().slice(0, 6)}`,
      tool: 'claude',
      scopes: ['read_public'],
      ...more,
    }),
    201,
  );
const current = async (id: unknown) =>
  (ok(await api.get('/api/agents', owner)).agents as Json[]).find((a) => a.id === id) as Json;
const patchAgent = async (id: unknown, body: Json) =>
  api.request('PATCH', `/api/agents/${id}`, owner, {
    version: (await current(id)).version,
    ...body,
  });

/** 이 에이전트에게 일을 맡기고 러너가 빌린다 */
async function take(agentId: unknown): Promise<Json> {
  const task = ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId,
      instruction: '도구로 조사',
    }),
    201,
  );
  for (let i = 0; i < 50; i++) {
    const { jobs } = (await call(runner, 'next_jobs')) as { jobs: Json[] };
    const mine = jobs.find((j) => j.task.id === task.id);
    if (mine) return mine;
    if (jobs.length === 0) break;
  }
  throw new Error('맡긴 일을 빌리지 못했어요');
}

async function drain(): Promise<void> {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  writer = { authorization: `Bearer ${await api.writeDevice(owner, 'tool-writer')}` };
  runner = await api.connectDevice(owner, 'tool-runner');
  const { devices } = ok(await api.get('/api/devices', owner));
  const device = (devices as Json[]).find((d) => d.name === 'tool-runner') as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...device.scopes, 'run'],
      version: device.version,
    }),
  );
});

after(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
  await db.sql`UPDATE task.agents SET status = 'paused'`;
  await drain();
  await api.close();
});

describe('외부 도구 (/api/external-tools)', () => {
  test('방문자와 write 기기는 보지도 만들지도 못한다 (403)', async () => {
    for (const headers of [{}, writer]) {
      const list = await api.request(
        'GET',
        '/api/external-tools',
        TestUser.visitor,
        undefined,
        headers,
      );
      assert.equal(list.status, 403, list.text);
      const made = await api.request(
        'POST',
        '/api/external-tools',
        TestUser.visitor,
        { requestId: randomUUID(), name: 'blocked', title: '막힘', url: 'https://mcp.example.com' },
        headers,
      );
      assert.equal(made.status, 403, made.text);
    }
  });

  test('관리자가 더하면 바로 쓴다. 토큰은 돌려주지 않고 있는지만 보인다. 같은 requestId는 하나', async () => {
    const requestId = randomUUID();
    const body = {
      requestId,
      name: 'notion',
      title: 'Notion',
      url: 'https://mcp.notion.example.com/mcp',
      headerName: 'Authorization',
      secret: SECRET,
    };
    const made = ok(await api.request('POST', '/api/external-tools', owner, body), 201);
    assert.deepEqual([made.status, made.hasSecret], ['active', true]);
    assert.equal(JSON.stringify(made).includes('tool-secret'), false, '토큰은 응답에 없다');
    const again = ok(await api.request('POST', '/api/external-tools', owner, body), 201);
    assert.equal(again.id, made.id);
    assert.equal(JSON.stringify(await listed()).includes('tool-secret'), false);
  });

  test('주소 · 이름 · 머리글 규칙: https 공개 도메인만, 이름은 한 번만 (422)', async () => {
    const base = { title: '틀림', name: 'bad-url' };
    for (const url of [
      'http://mcp.example.com',
      'https://localhost/mcp',
      'https://10.0.0.1/mcp',
      'https://intranet/mcp',
      'https://svc.internal/mcp',
      'https://user:pw@mcp.example.com',
    ])
      assert.equal((await create({ ...base, url })).status, 422, url);
    assert.equal(
      (await create({ title: 'x', name: 'Bad Name', url: 'https://a.example.com' })).status,
      422,
    );
    assert.equal(
      (await create({ title: 'x', name: 'hdr', url: 'https://a.example.com', headerName: 'Host' }))
        .status,
      422,
    );
    ok(await create({ title: '첫째', name: 'twice', url: 'https://a.example.com' }), 201);
    assert.equal(
      (await create({ title: '둘째', name: 'twice', url: 'https://b.example.com' })).status,
      422,
    );
  });

  test('허락한 에이전트의 일에만 머리글(토큰)과 함께 실린다. 토큰이 없거나 꺼지면 빠진다', async () => {
    const tool = ok(
      await create({
        name: 'search',
        title: '검색',
        url: 'https://mcp.search.example.com/mcp',
        headerName: 'X-Api-Key',
      }),
      201,
    );
    const a = await agent({ externalTools: ['search'] });
    assert.deepEqual(a.externalTools, ['search']);
    assert.deepEqual((await take(a.id)).tools, [], '토큰이 없으면 붙이지 않는다');

    const sealed = ok(
      await api.request('POST', `/api/external-tools/${tool.id}/secret`, owner, {
        secret: 'key-987654',
        version: tool.version,
      }),
    );
    assert.equal(sealed.hasSecret, true);
    const job = await take(a.id);
    assert.deepEqual(job.tools, [
      {
        name: 'search',
        title: '검색',
        url: 'https://mcp.search.example.com/mcp',
        headers: { 'X-Api-Key': 'key-987654' },
      },
    ]);
    const other = await agent();
    assert.deepEqual((await take(other.id)).tools, [], '허락하지 않은 에이전트에는 없다');

    ok(
      await api.request('PATCH', `/api/external-tools/${tool.id}`, owner, {
        enabled: false,
        version: sealed.version,
      }),
    );
    assert.deepEqual((await take(a.id)).tools, [], '끈 도구는 빠진다');
  });

  test('비공개 · 셸 권한의 에이전트에는 붙이지 못하고, 없는 도구는 허락하지 못한다 (422)', async () => {
    ok(await create({ name: 'plain', title: '평범', url: 'https://plain.example.com/mcp' }), 201);
    for (const scopes of [['read_all'], ['write'], ['code'], ['make']])
      assert.equal(
        (
          await api.request('POST', '/api/agents', owner, {
            requestId: randomUUID(),
            name: '막힘',
            tool: 'claude',
            scopes,
            externalTools: ['plain'],
          })
        ).status,
        422,
        scopes.join(),
      );
    const a = await agent({ externalTools: ['plain'] });
    assert.equal(
      (await patchAgent(a.id, { scopes: ['read_all'] })).status,
      422,
      '붙인 채로 비공개',
    );
    assert.equal((await patchAgent(a.id, { externalTools: ['no-such'] })).status, 422);
  });

  test('지우면 허락한 에이전트에서도 빠진다', async () => {
    const tool = ok(
      await create({ name: 'gone', title: '지울 것', url: 'https://gone.example.com' }),
      201,
    );
    const a = await agent({ externalTools: ['gone'] });
    ok(
      await api.request('POST', `/api/external-tools/${tool.id}/delete`, owner, {
        version: tool.version,
      }),
      204,
    );
    assert.deepEqual((await current(a.id)).externalTools, []);
    assert.equal(await one('gone'), undefined);
  });
});

describe('AI의 제안 → 결재 → 붙음', () => {
  async function propose(scopes: readonly string[] = ['read_public']) {
    const a = await agent({ scopes, approvalActions: ['task.tool.plug'] });
    const job = await take(a.id);
    return { a, job, token: String(job.run_token) };
  }

  test('제안은 결재를 기다리고, 승인하면 켜지고 제안한 에이전트에 붙는다. 작업은 결과로 끝난다', async () => {
    const { a, job, token } = await propose();
    const proposed = await call(token, 'propose_tool', {
      request_id: randomUUID(),
      name: 'linear',
      title: 'Linear',
      url: 'https://mcp.linear.example.com/sse',
      header_name: 'Authorization',
      note: '이슈를 읽으려고',
    });
    assert.deepEqual([proposed.status, proposed.version], ['proposed', 1]);
    assert.equal((await one('linear'))?.status, 'proposed');
    assert.deepEqual((await current(a.id)).externalTools, [], '승인 전에는 붙지 않는다');

    const asked = await call(token, 'request_approval', {
      request_id: randomUUID(),
      action: 'task.tool.plug',
      target_kind: 'external_tool',
      target_id: proposed.tool_id,
      target_version: proposed.version,
      note: 'Linear를 붙여 주세요',
    });
    const approval = ok(await api.get(`/api/approvals/${asked.approval_id}`, owner));
    ok(
      await api.request('POST', `/api/approvals/${approval.id}/decide`, owner, {
        version: approval.version,
        decision: 'approve',
      }),
    );
    await drain();
    const plugged = await one('linear');
    assert.deepEqual([plugged?.status, plugged?.hasSecret], ['active', false]);
    assert.deepEqual((await current(a.id)).externalTools, ['linear']);
    assert.equal(ok(await api.get(`/api/tasks/${job.task.id}`, owner)).status, 'done');
  });

  test('반려하면 제안이 지워진다', async () => {
    const { token } = await propose();
    const proposed = await call(token, 'propose_tool', {
      request_id: randomUUID(),
      name: 'rejected-one',
      title: '거절될 것',
      url: 'https://mcp.reject.example.com',
      note: '필요해 보여서',
    });
    const asked = await call(token, 'request_approval', {
      request_id: randomUUID(),
      action: 'task.tool.plug',
      target_kind: 'external_tool',
      target_id: proposed.tool_id,
      target_version: proposed.version,
    });
    const approval = ok(await api.get(`/api/approvals/${asked.approval_id}`, owner));
    ok(
      await api.request('POST', `/api/approvals/${approval.id}/decide`, owner, {
        version: approval.version,
        decision: 'reject',
      }),
    );
    await drain();
    assert.equal(await one('rejected-one'), undefined);
  });

  test('비공개를 읽는 에이전트는 제안하지 못하고, 토큰 칸은 받지 않는다', async () => {
    const { token } = await propose(['read_all']);
    const blocked = await tool(token, 'propose_tool', {
      request_id: randomUUID(),
      name: 'leak',
      title: '새는 것',
      url: 'https://mcp.leak.example.com',
      note: '-',
    });
    assert.equal(blocked.ok, false);
    assert.equal(await one('leak'), undefined);
  });
});
