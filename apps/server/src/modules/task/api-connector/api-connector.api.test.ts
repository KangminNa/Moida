import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';
import { ApiCallJob } from './api-call.job';

// API 커넥터 (2026-11-24 도구를 찾아 붙이기): 일꾼의 propose_api → 결재(task.api.plug, 서버가 올림) → 관리자가 키 →
// api_tools · api_run(서버가 정의서대로 부름) → 상태 묻기 · 파일 받기(ApiCallJob) → 결과물. 쓰기 · 한도를 넘은 부르기는 승인 뒤.
// 바깥 서비스는 루프백의 가짜 서버다 (CAIRN_OAUTH_TEST_LOOPBACK=1일 때만 http · 127.0.0.1을 연다). AI는 띄우지 않는다.

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 테스트 (모양은 assert가 본다)
type Json = Record<string, any>;

const LOOPBACK = 'CAIRN_OAUTH_TEST_LOOPBACK';
const KEY = 'svc-key-0123456789';
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

/** 가짜 MCP 레지스트리의 답 (find_tool) */
const REGISTRY = {
  servers: [
    {
      server: {
        name: 'ai.hostco/imagegen',
        remotes: [{ type: 'streamable-http', url: 'https://mcp.hostco.ai/x' }],
      },
    },
    {
      server: {
        name: 'com.imagegen/mcp',
        remotes: [{ type: 'streamable-http', url: 'https://mcp.imagegen.com/mcp' }],
      },
    },
  ],
};

let api: ApiClient;
let owner: TestUser;
let db: Database;
let worker: OutboxWorker;
let runner: string;
let fake: Server;
let base: string;
/** 가짜 서비스가 받은 요청 (방법 · 경로 · 키 머리글 · 본문) */
const seen: { method: string; path: string; key: string | null; body: string }[] = [];
let polls = 0;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.status === 204 ? {} : res.json();
}

async function tool(token: string, name: string, args: Json = {}) {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as Json | undefined;
  if (!result) throw new Error(res.text);
  return result.isError
    ? { ok: false, body: { text: result.content?.[0]?.text ?? '' } as Json }
    : { ok: true, body: (result.structuredContent ?? {}) as Json };
}

async function call(token: string, name: string, args: Json = {}): Promise<Json> {
  const { ok: done, body } = await tool(token, name, args);
  assert.equal(done, true, JSON.stringify(body));
  return body;
}

async function drain(): Promise<void> {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

/** 새 일꾼에게 일을 맡기고 러너가 빌린다 (작업 토큰) */
async function job(): Promise<Json> {
  const a = ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `API ${randomUUID().slice(0, 6)}`,
      tool: 'claude',
    }),
    201,
  );
  const task = ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: a.id,
      instruction: '그림 만들기',
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

async function decide(approvalId: string, decision: 'approve' | 'reject'): Promise<void> {
  const approval = ok(await api.get(`/api/approvals/${approvalId}`, owner));
  ok(
    await api.request('POST', `/api/approvals/${approval.id}/decide`, owner, {
      version: approval.version,
      decision,
    }),
  );
  await drain();
}

const listed = async (): Promise<Json[]> =>
  ok(await api.get('/api/api-connectors', owner)).connectors as Json[];
const one = async (name: string) => (await listed()).find((c) => c.name === name);

function spec(): Json {
  return {
    base: `${base}/v1`,
    auth: { headers: [{ name: 'x-key' }] },
    operations: [
      { name: 'me', title: '내 정보', effect: 'read', method: 'GET', path: '/me' },
      {
        name: 'make_image',
        title: '그림 만들기',
        effect: 'spend',
        method: 'POST',
        path: '/images',
        input: { prompt: { type: 'string', required: true } },
        body: { params: { prompt: '{prompt}' } },
        pick: { id: 'request_id' },
        poll: { path: '/images/{id}', status: 'status', done: ['completed'], every_seconds: 2 },
        files: ['images[*].url'],
      },
      {
        name: 'post',
        title: '글 올리기',
        effect: 'write',
        method: 'POST',
        path: '/posts',
        input: { text: { type: 'string', required: true } },
      },
    ],
  };
}

function serve(req: IncomingMessage, body: string): [number, unknown] | Buffer {
  const path = req.url ?? '';
  if (path === '/files/a.png') return PNG;
  if (path.startsWith('/v0.1/servers?')) return [200, REGISTRY];
  if (req.headers['x-key'] !== KEY) return [401, { message: '키가 없어요' }];
  if (path === '/v1/me') return [200, { name: '테스트 계정', credits: 10 }];
  if (path === '/v1/images' && req.method === 'POST')
    return [200, { request_id: 'job-1', status: 'queued', echo: JSON.parse(body) }];
  if (path === '/v1/images/job-1') {
    polls += 1;
    return polls < 2
      ? [200, { status: 'running' }]
      : [200, { status: 'completed', images: [{ url: `${base}/files/a.png` }] }];
  }
  if (path === '/v1/posts') return [201, { id: 'p1' }];
  return [404, { message: '없어요' }];
}

before(async () => {
  process.env[LOOPBACK] = '1';
  fake = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      seen.push({
        method: req.method ?? '',
        path: req.url ?? '',
        key: (req.headers['x-key'] as string | undefined) ?? null,
        body,
      });
      const out = serve(req, body);
      if (Buffer.isBuffer(out)) {
        res.writeHead(200, { 'content-type': 'image/png' }).end(out);
        return;
      }
      res.writeHead(out[0], { 'content-type': 'application/json' }).end(JSON.stringify(out[1]));
    });
  });
  await new Promise<void>((done) => fake.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  process.env.CAIRN_TOOL_REGISTRY_URL = base;
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: 'API', siteUrl: api.baseUrl, version });
  const name = `api-runner-${randomUUID().slice(0, 6)}`;
  runner = await api.connectDevice(owner, name);
  const { devices } = ok(await api.get('/api/devices', owner));
  const device = (devices as Json[]).find((d) => d.name === name) as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...device.scopes, 'run'],
      version: device.version,
    }),
  );
});

after(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
  await db.sql`UPDATE task.agents SET status = 'paused' WHERE NOT lead`;
  await drain();
  await api.close();
  fake.close();
  delete process.env[LOOPBACK];
  delete process.env.CAIRN_TOOL_REGISTRY_URL;
});

describe('API 커넥터', () => {
  test('방문자 · 기기는 관리 API를 쓰지 못한다 (403)', async () => {
    const res = await api.request('GET', '/api/api-connectors', TestUser.visitor);
    assert.equal(res.status, 403, res.text);
  });

  test('제안 → 승인 → 키 → 부르기 · 상태 묻기 · 파일이 결과물로 → 쓰기 · 한도는 승인 뒤', async () => {
    // 1) 제안: 정의서를 거르고 결재를 함께 올린다. 작업은 기다린다
    const first = await job();
    const token = String(first.run_token);
    const proposed = await call(token, 'propose_api', {
      request_id: randomUUID(),
      name: 'imagegen',
      title: '그림 서비스',
      note: '그림을 만들려고',
      source: { kind: 'docs', url: 'https://docs.example.com/api' },
      spec: spec(),
    });
    assert.equal(proposed.status, 'proposed');
    const before = await one('imagegen');
    assert.deepEqual(
      [before?.status, before?.keys, before?.operations.length],
      ['proposed', [{ name: 'x-key', set: false }], 3],
    );
    // request_approval로는 올리지 못한다 (서버가 올린다)
    const raised = await tool(token, 'request_approval', {
      request_id: randomUUID(),
      action: 'task.api.plug',
      target_kind: 'api_connector',
      target_id: before?.id,
      target_version: 1,
    });
    assert.equal(raised.ok, false);
    assert.match(raised.body.text, /서버가 올려요/);

    await decide(String(proposed.approval_id), 'approve');
    assert.equal((await one('imagegen'))?.status, 'active');
    assert.equal(ok(await api.get(`/api/tasks/${first.task.id}`, owner)).status, 'done');

    // 2) 키 전: api_tools에 ready false, 부르면 까닭
    const work = await job();
    const t2 = String(work.run_token);
    const tools = (await call(t2, 'api_tools')).connectors as Json[];
    assert.deepEqual(
      tools.map((c) => [c.connector, c.ready]),
      [['imagegen', false]],
    );
    const noKey = await tool(t2, 'api_run', {
      request_id: randomUUID(),
      connector: 'imagegen',
      operation: 'me',
    });
    assert.match(noKey.body.text, /키가 아직 없어요/);

    // 3) 관리자가 키를 넣는다 (값은 돌려주지 않는다)
    const connector = (await one('imagegen')) as Json;
    const keyed = ok(
      await api.request('POST', `/api/api-connectors/${connector.id}/keys`, owner, {
        version: connector.version,
        keys: { 'x-key': KEY },
      }),
    );
    assert.deepEqual(keyed.keys, [{ name: 'x-key', set: true }]);
    assert.ok(!JSON.stringify(await listed()).includes(KEY), '키는 어디에도 나오지 않는다');

    // 4) 읽기: 바로 답. 서비스는 키 머리글을 받았다
    const me = await call(t2, 'api_run', {
      request_id: randomUUID(),
      connector: 'imagegen',
      operation: 'me',
    });
    assert.deepEqual([me.status, me.answer?.name], ['done', '테스트 계정']);
    assert.equal(seen.find((s) => s.path === '/v1/me' && s.key === KEY)?.method, 'GET');

    // 5) 돈이 드는 생성: 본문 틀 → polling → 일꾼이 상태를 묻고 파일을 받는다 → 결과물
    const made = await call(t2, 'api_run', {
      request_id: randomUUID(),
      connector: 'imagegen',
      operation: 'make_image',
      input: { prompt: '고양이' },
    });
    assert.deepEqual([made.status, made.answer], ['polling', { id: 'job-1' }]);
    assert.deepEqual(JSON.parse(seen.find((s) => s.path === '/v1/images')?.body ?? '{}'), {
      params: { prompt: '고양이' },
    });
    const job_ = api.service(ApiCallJob);
    for (let i = 0; i < 4; i++) await job_.run(new Date(Date.now() + (i + 1) * 60_000));
    const settled = await call(t2, 'api_call', { call_id: made.call_id });
    assert.equal(settled.status, 'done', JSON.stringify(settled));
    assert.equal(settled.output_ids.length, 1);
    const [output] = await db.sql<Json[]>`
      SELECT task_id, name, mime FROM task.outputs WHERE id = ${settled.output_ids[0]}`;
    assert.deepEqual([output?.task_id, output?.mime], [work.task.id, 'image/png']);
    assert.match(String(output?.name), /^make_image-.{8}-1\.png$/);
    assert.equal(seen.find((s) => s.path === '/files/a.png')?.key, null, '파일은 키 없이 받는다');

    // 6) 바깥에 남기는 동작: 승인을 기다린다 → 승인 → 한 번 부르고 작업은 이어서 한다
    const post = await call(t2, 'api_run', {
      request_id: randomUUID(),
      connector: 'imagegen',
      operation: 'post',
      input: { text: '안녕' },
    });
    assert.deepEqual([post.status, post.held_reason], ['held', 'write']);
    assert.equal(seen.filter((s) => s.path === '/v1/posts').length, 0, '승인 전에는 보내지 않는다');
    await decide(String(post.approval_id), 'approve');
    assert.equal(seen.filter((s) => s.path === '/v1/posts').length, 1);
    assert.equal(ok(await api.get(`/api/tasks/${work.task.id}`, owner)).status, 'queued');

    // 7) 하루 한도: 0으로 낮추면 돈이 드는 부르기도 승인을 기다린다. 반려하면 refused
    const latest = (await one('imagegen')) as Json;
    assert.equal(latest.spentToday, 1);
    ok(
      await api.request('PATCH', `/api/api-connectors/${latest.id}`, owner, {
        version: latest.version,
        dailyMax: 0,
      }),
    );
    const third = await job();
    const held = await call(String(third.run_token), 'api_run', {
      request_id: randomUUID(),
      connector: 'imagegen',
      operation: 'make_image',
      input: { prompt: '개' },
    });
    assert.deepEqual([held.status, held.held_reason], ['held', 'limit']);
    await decide(String(held.approval_id), 'reject');
    const [refused] = await db.sql<
      Json[]
    >`SELECT status FROM task.api_calls WHERE id = ${held.call_id}`;
    assert.equal(refused?.status, 'refused');
  });

  test('있는 이름으로 다시 내면 새 버전 제안: 승인하면 앞 버전을 남긴다, 반려하면 지금 것이 그대로', async () => {
    const t = String((await job()).run_token);
    const name = `rev-${randomUUID().slice(0, 6)}`;
    const p1 = await call(t, 'propose_api', {
      request_id: randomUUID(),
      name,
      title: '고치기',
      source: { kind: 'manual' },
      spec: spec(),
    });
    await decide(String(p1.approval_id), 'approve');
    const t2 = String((await job()).run_token);
    const next = { ...spec(), operations: [spec().operations[0]] };
    const p2 = await call(t2, 'propose_api', {
      request_id: randomUUID(),
      name,
      title: '고치기',
      source: { kind: 'manual' },
      spec: next,
    });
    assert.equal((await one(name))?.pending?.operations.length, 1);
    await decide(String(p2.approval_id), 'approve');
    const after = (await one(name)) as Json;
    assert.deepEqual([after.operations.length, after.history, after.pending], [1, 1, null]);
  });

  test('관리자의 시험은 승인 없이 바로 부른다', async () => {
    const c = (await one('imagegen')) as Json;
    const tried = ok(
      await api.request('POST', `/api/api-connectors/${c.id}/try`, owner, {
        requestId: randomUUID(),
        operation: 'me',
        input: {},
      }),
    );
    assert.deepEqual([tried.status, tried.tried], ['done', true]);
    const recent = ok(await api.get(`/api/api-connectors/${c.id}/calls`, owner)).calls as Json[];
    assert.ok(recent.some((r) => r.id === tried.id));
  });

  test('find_tool: 서버가 레지스트리를 찾아 공식 후보를 먼저 준다 (붙이지는 않는다)', async () => {
    const t = String((await job()).run_token);
    const found = await call(t, 'find_tool', { query: 'imagegen', domain: 'imagegen.com' });
    assert.deepEqual(
      (found.candidates as Json[]).map((c) => [c.name, c.official]),
      [
        ['com.imagegen/mcp', true],
        ['ai.hostco/imagegen', false],
      ],
    );
    assert.match(found.note, /자료/);
    assert.ok(seen.some((s) => s.path.startsWith('/v0.1/servers?search=imagegen')));
  });
});
