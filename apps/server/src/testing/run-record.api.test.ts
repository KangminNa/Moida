import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { Database } from '../modules/platform';
import { ApiClient, type ApiResult, type TestUser } from './api-client';

// 에이전트 실행의 기록 (작업 세션, 기획서 결정 2026-11-17): 러너가 일을 빌리면 세션 키(next_jobs의 run)를 받고,
// CLI가 끝난 뒤 save_run_record로 원문 · 인수인계 메모를 요청 하나의 작업 세션에 쌓는다. 다음 실행은 run_memos로
// 같은 세션 키의 메모를 받는다. 그 일을 잡은 러너만, 점유 시간이 남았을 때만 (기다리는 중이어도)

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let runner: string;
let otherRunner: string;
let collector: string;
let agent: Json;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function tool(token: string, name: string, args: Json = {}): Promise<Json> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as Json;
  return result.isError
    ? { ok: false, ...JSON.parse(String(result.content[0]?.text ?? '{}')) }
    : { ok: true, ...(result.structuredContent ?? {}) };
}

async function newTask(more: Json = {}): Promise<Json> {
  return ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: agent.id,
      kind: 'general',
      title: '산책 글 정리',
      instruction: '지난주 산책 기록을 정리해 주세요',
      ...more,
    }),
    201,
  );
}

/** 이 러너가 그 작업을 빌린다 */
async function lease(token: string, taskId: string): Promise<Json> {
  const next = await tool(token, 'next_jobs', {
    wait_seconds: 0,
    limit: 5,
    tools: ['claude'],
    own_logins: [],
  });
  assert.equal(next.ok, true, JSON.stringify(next));
  const job = (next.jobs as Json[]).find((j) => j.task.id === taskId);
  assert.ok(job, `빌리지 못했다: ${JSON.stringify(next.jobs)}`);
  return job;
}

const record = (token: string, taskId: string, more: Json = {}) =>
  tool(token, 'save_run_record', {
    task_id: taskId,
    request_id: randomUUID(),
    transcript: '## 지시\n산책 기록 정리\n## AI\n정리했어요 (도구: Read)',
    memo: '한 일: 기록 셋을 묶음. 남은 일: 사진 고르기',
    memo_by: 'ai',
    resumed: false,
    ...more,
  });

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  ok(
    await api.request('PUT', '/api/space', owner, { name: '기록', siteUrl: api.baseUrl, version }),
  );
  const made = async (name: string) =>
    String(
      ok(
        await api.request('POST', '/api/devices/runner', owner, { requestId: randomUUID(), name }),
        201,
      ).token,
    );
  runner = await made(`기록 러너 ${randomUUID().slice(0, 6)}`);
  otherRunner = await made(`기록 다른 러너 ${randomUUID().slice(0, 6)}`);
  ok(
    await api.request('PUT', '/api/ai/claude/token', owner, {
      token: `sk-ant-oat01-${randomUUID()}`,
    }),
  );
  collector = await api.connectDevice(owner, '노트북 · 기록', 'collect');
  agent = ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: '정리',
      tool: 'claude',
      scopes: ['read_public', 'write'],
      approvalActions: ['blog.post.publish'],
    }),
    201,
  );
});
// 다른 시험의 일이 먼저 빌려 가지 않게
beforeEach(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});
after(() => api.close());

describe('실행 기록 (save_run_record · run_memos)', () => {
  test('빌린 일에는 세션 키가 실린다. 잡은 러너만 기록하고, 같은 request_id는 한 번만 쌓인다', async () => {
    const task = await newTask();
    const job = await lease(runner, task.id);
    assert.deepEqual(job.run, { lineage: `task:${task.id}`, keep: true, resume: null });

    assert.deepEqual(await tool(runner, 'run_memos', { task_id: task.id }), {
      ok: true,
      session_id: null,
      memos: [],
    });
    const notMine = await record(otherRunner, task.id);
    assert.deepEqual([notMine.ok, notMine.code], [false, 'rule_violation']);
    const noRun = await record(collector, task.id);
    assert.deepEqual([noRun.ok, noRun.code], [false, 'forbidden']);
    assert.equal((await api.mcp('', 'tools/list')).status, 401, '방문자는 MCP에 닿지 못한다');

    const requestId = randomUUID();
    const memo = '한 일: 기록 셋. 연락처 010-1234-5678, me@example.com';
    const first = await record(runner, task.id, { request_id: requestId, memo });
    assert.deepEqual(
      [first.ok, first.status, first.seq],
      [true, 'saved', 1],
      JSON.stringify(first),
    );
    assert.equal(first.warnings.length, 2, '마스킹한 개인정보를 알린다');
    const again = await record(runner, task.id, { request_id: requestId, memo });
    assert.deepEqual(
      [again.status, again.session_id, again.seq],
      ['duplicate', first.session_id, 1],
    );

    const session = ok(await api.get(`/api/sessions/${first.session_id}`, owner));
    assert.deepEqual(
      [
        session.title,
        session.tool,
        session.sourceSessionId,
        session.transcriptCount,
        session.revisionCount,
      ],
      ['산책 글 정리', 'cairn-agent', `task:${task.id}`, 1, 1],
    );
    assert.equal(session.visibility, 'private');
    assert.equal(session.head.actorType, 'system');
    assert.match(session.head.markdown, /### 산책 글 정리 · 정리 \(1번째 실행\)/);
    const raw = ok(await api.get(`/api/sessions/${first.session_id}/transcripts/1`, owner));
    assert.match(raw.text, /^# 1번째 실행 · 정리 \(claude\)/);
    assert.match(raw.text, /## 인수인계 메모/);
    for (const personal of ['010-1234-5678', 'me@example.com'])
      assert.equal(raw.text.includes(personal), false, personal);

    const memos = await tool(runner, 'run_memos', { task_id: task.id });
    assert.equal(memos.session_id, first.session_id);
    assert.deepEqual(
      memos.memos.map((m: Json) => [m.agent, m.task_title, m.run_seq, m.memo]),
      [['정리', '산책 글 정리', 1, '한 일: 기록 셋. 연락처 [지움: 전화번호], [지움: 이메일]']],
    );
    const [saved] = await db.sql`
      SELECT count(*)::int AS n FROM platform.outbox
      WHERE topic = 'vault.session.saved' AND payload->>'sessionId' = ${first.session_id}`;
    assert.equal(saved?.n, 0, '작업 세션은 자동 정리 · 세션 알림을 부르지 않는다');
  });

  test('승인을 기다리는 중이어도 점유 시간이 남았으면 기록한다. 끝난 일은 못 한다', async () => {
    const task = await newTask();
    const job = await lease(runner, task.id);
    const asked = await tool(job.run_token, 'request_approval', {
      request_id: randomUUID(),
      action: 'blog.post.publish',
      target_kind: 'post',
      target_id: randomUUID(),
      target_version: 1,
      note: '공개해 주세요',
    });
    assert.equal(asked.ok, true, JSON.stringify(asked));
    const waiting = await record(runner, task.id);
    assert.deepEqual([waiting.ok, waiting.status], [true, 'saved'], JSON.stringify(waiting));

    const done = await newTask();
    await lease(runner, done.id);
    const submitted = await tool(runner, 'submit_result', {
      task_id: done.id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '끝' },
    });
    assert.equal(submitted.ok, true, JSON.stringify(submitted));
    const late = await record(runner, done.id);
    assert.deepEqual([late.ok, late.code], [false, 'rule_violation']);
  });

  test('CLI 세션 id를 보고하면 같은 세션 키 · 같은 러너의 다음 실행에 재개 후보로 실린다', async () => {
    const task = await newTask();
    await lease(runner, task.id);
    const reported = await tool(runner, 'report_progress', {
      task_id: task.id,
      events: [],
      cli_session: 'cli-session-1',
      resumed: false,
    });
    assert.equal(reported.ok, true, JSON.stringify(reported));
    await tool(runner, 'report_progress', { task_id: task.id, events: [], cli_session: 'other' });
    const [run] = await db.sql`
      SELECT lineage, cli_session, resumed FROM task.task_runs WHERE task_id = ${task.id}`;
    assert.deepEqual(
      [run?.lineage, run?.cli_session, run?.resumed],
      [`task:${task.id}`, 'cli-session-1', false],
      '첫 보고의 값만 남는다',
    );

    const released = await tool(runner, 'release_job', { task_id: task.id, reason: '다시' });
    assert.equal(released.ok, true, JSON.stringify(released));
    const again = await lease(runner, task.id);
    assert.deepEqual(again.run.resume, { cli_session: 'cli-session-1' });
    await tool(runner, 'release_job', { task_id: task.id, reason: '다른 러너로' });
    const elsewhere = await lease(otherRunner, task.id);
    assert.equal(elsewhere.run.resume, null, '다른 러너는 그 세션 파일이 없다');
  });
});
