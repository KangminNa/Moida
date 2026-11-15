import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';

// 설정 바꾸기 제안 (2026-11-15 C): get_settings → propose_setting(미리 해 보기 + 결재 task.setting.change) → 승인 → 적용.
// 러너는 MCP로, 관리자는 REST로 들어오고 승인 뒤 적용은 outbox와 일꾼을 실제로 거친다. AI는 띄우지 않는다.

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let worker: OutboxWorker;
/** run 권한 기기 (러너) */
let runner: string;

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

const agent = async (more: Json = {}) =>
  ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `설정 ${randomUUID().slice(0, 6)}`,
      tool: 'claude',
      scopes: ['read_public'],
      ...more,
    }),
    201,
  );
const current = async (id: unknown) =>
  (ok(await api.get('/api/agents', owner)).agents as Json[]).find((a) => a.id === id) as Json;

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

/** 대화 상대(관리자 바로 아래) 하나와 그 팀원 하나. 대화 상대의 일을 러너가 빌린 토큰 */
async function partner() {
  const lead = await agent();
  const member = await agent({ reportsTo: lead.id, model: 'sonnet' });
  const job = await take(lead.id);
  return { lead, member, job, token: String(job.run_token) };
}

async function decide(approvalId: unknown, decision = 'approve') {
  const approval = ok(await api.get(`/api/approvals/${approvalId}`, owner));
  ok(
    await api.request('POST', `/api/approvals/${approvalId}/decide`, owner, {
      version: approval.version,
      decision,
    }),
  );
  await drain();
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  runner = await api.connectDevice(owner, 'setting-runner');
  const { devices } = ok(await api.get('/api/devices', owner));
  const device = (devices as Json[]).find((d) => d.name === 'setting-runner') as Json;
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

describe('설정 바꾸기: 읽기와 제안', () => {
  test('대화 상대는 팀을 읽고, 바꿀 값을 제안하면 결재가 바뀔 칸과 함께 올라온다. 승인 전에는 바뀌지 않는다', async () => {
    const { member, job, token } = await partner();
    const team = await call(token, 'get_settings', { kind: 'team' });
    const seen = (team.agents as Json[]).find((a) => a.id === member.id) as Json;
    assert.equal(seen.model, 'sonnet');
    assert.equal(seen.reports_to !== null, true);
    const proposed = await call(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'agent',
      op: 'edit',
      target_id: member.id,
      version: seen.version,
      fields: { model: 'opus', scopes: ['read_public', 'draft'] },
      note: '글을 쓰게 하려고',
    });
    assert.equal(proposed.status, 'pending');
    assert.deepEqual(
      (proposed.changes as Json[]).map((c) => [c.field, c.before, c.after, c.grant]),
      [
        ['model', 'sonnet', 'opus', false],
        ['scopes', ['read_public'], ['read_public', 'draft'], true],
      ],
    );
    const approval = ok(await api.get(`/api/approvals/${proposed.approval_id}`, owner));
    assert.equal(approval.action, 'task.setting.change');
    assert.equal((approval.changes as Json[]).length, 2);
    assert.equal((await current(member.id)).model, 'sonnet', '승인 전에는 그대로');
    assert.equal(ok(await api.get(`/api/tasks/${job.task.id}`, owner)).status, 'waiting');

    await decide(proposed.approval_id);
    const changed = await current(member.id);
    assert.equal(changed.model, 'opus');
    assert.deepEqual(changed.scopes, ['read_public', 'draft']);
    assert.equal(ok(await api.get(`/api/tasks/${job.task.id}`, owner)).status, 'running');
  });

  test('규칙에 어긋나면 제안하는 자리에서 막힌다 (브라우저 + 전체 읽기)', async () => {
    const { member, token } = await partner();
    const res = await tool(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'agent',
      op: 'edit',
      target_id: member.id,
      version: (await current(member.id)).version,
      fields: { scopes: ['browse', 'read_all'] },
      note: '둘 다',
    });
    assert.equal(res.ok, false);
    assert.equal(res.body.code, 'rule_violation');
  });

  test('낡은 버전은 409, 바뀌는 칸이 없으면 422, 모르는 칸은 400', async () => {
    const { member, token } = await partner();
    const base = { setting: 'agent', op: 'edit', target_id: member.id, note: '왜' };
    const stale = await tool(token, 'propose_setting', {
      ...base,
      request_id: randomUUID(),
      version: (await current(member.id)).version + 5,
      fields: { model: 'opus' },
    });
    assert.equal(stale.body.code, 'conflict');
    const same = await tool(token, 'propose_setting', {
      ...base,
      request_id: randomUUID(),
      version: (await current(member.id)).version,
      fields: { model: 'sonnet' },
    });
    assert.equal(same.body.code, 'rule_violation');
    const strange = await tool(token, 'propose_setting', {
      ...base,
      request_id: randomUUID(),
      version: (await current(member.id)).version,
      fields: { password: 'x' },
    });
    assert.equal(strange.body.code, 'invalid_request');
  });

  test('승인한 뒤 대상이 바뀌었으면 적용하지 않고 실패로 끝난다', async () => {
    const { member, job, token } = await partner();
    const proposed = await call(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'agent',
      op: 'edit',
      target_id: member.id,
      version: (await current(member.id)).version,
      fields: { model: 'opus' },
      note: '바꿔요',
    });
    ok(
      await api.request('PATCH', `/api/agents/${member.id}`, owner, {
        version: (await current(member.id)).version,
        name: '그사이 바뀜',
      }),
    );
    await decide(proposed.approval_id);
    assert.equal((await current(member.id)).model, 'sonnet');
    const task = ok(await api.get(`/api/tasks/${job.task.id}`, owner));
    assert.notEqual(task.status, 'waiting');
  });

  test('멈추기 제안과 스케줄 만들기 제안도 승인 뒤에 적용된다', async () => {
    const { member, token } = await partner();
    const paused = await call(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'agent',
      op: 'pause',
      target_id: member.id,
      version: (await current(member.id)).version,
      note: '잠시 쉬게',
    });
    await decide(paused.approval_id);
    assert.equal((await current(member.id)).status, 'paused');

    const { token: other } = await partner();
    const title = `매주 정리 ${randomUUID().slice(0, 6)}`;
    const made = await call(other, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'schedule',
      op: 'create',
      fields: {
        title,
        enabled: false,
        mode: 'daily',
        at_time: '09:30',
        time_zone: 'Asia/Seoul',
        instruction: '주간 정리',
        daily_max: 1,
      },
      note: '매주 정리하려고',
    });
    await decide(made.approval_id);
    const { schedules } = ok(await api.get('/api/schedules', owner));
    assert.ok((schedules as Json[]).some((s) => s.title === title));
  });
});

describe('설정 바꾸기: 막는 것', () => {
  test('팀원은 승인 동작에 넣어 주지 않으면 읽지도 제안하지도 못한다', async () => {
    const lead = await agent();
    const member = await agent({ reportsTo: lead.id });
    const job = await take(member.id);
    const res = await tool(String(job.run_token), 'get_settings', { kind: 'team' });
    assert.equal(res.ok, false);
    assert.equal(res.body.code, 'forbidden');
  });

  test('브라우저 에이전트는 대화 상대여도 읽지 못한다', async () => {
    const browser = await agent({ scopes: ['browse'] });
    const job = await take(browser.id);
    const res = await tool(String(job.run_token), 'get_settings', { kind: 'schedules' });
    assert.equal(res.body.code, 'forbidden');
  });

  test('request_approval로 설정 바꾸기를 바로 올리지 못한다 (바뀔 값을 서버가 미리 해 봐야)', async () => {
    const { member, token } = await partner();
    const res = await tool(token, 'request_approval', {
      request_id: randomUUID(),
      action: 'task.setting.change',
      target_kind: 'agent',
      target_id: member.id,
      target_version: 1,
    });
    assert.equal(res.body.code, 'rule_violation');
  });

  test('방문자는 MCP 설정 도구를 부르지 못한다 (작업 토큰으로만)', async () => {
    const visitor = await api.mcp(null, 'tools/call', {
      name: 'get_settings',
      arguments: { kind: 'team' },
    });
    assert.equal(visitor.status, 401);
  });
});
