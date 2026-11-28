import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { Database, OutboxWorker } from '../modules/platform';
import { ApiClient, type ApiResult, type TestUser } from './api-client';

// 끝난 요청의 작업 세션만 wiki 정리에 (S2, 기획서 결정 2026-11-17 · 2026-11-28): 맨 위 작업이 완료로 끝나면
// 그때까지의 판을 정리할 판(settled_seq)으로 적고 정리를 요청한다. 실패 · 취소된 요청은 원문으로만 둔다.
// 세션 화면은 GET api/sessions/:id/work로 요청 · 정리 상태 · 인수인계 메모를 읽는다 (관리자만)

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 테스트 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let worker: OutboxWorker;
let runner: string;
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

/** 일 하나를 맡기고 빌려 기록 하나를 쌓는다. 작업과 작업 세션 id */
async function recorded(title: string): Promise<[Json, string]> {
  const task = ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: agent.id,
      kind: 'general',
      title,
      instruction: `${title}를 해 주세요`,
    }),
    201,
  );
  const next = await tool(runner, 'next_jobs', {
    wait_seconds: 0,
    limit: 5,
    tools: ['claude'],
    own_logins: [],
  });
  assert.ok(
    (next.jobs as Json[]).some((j) => j.task.id === task.id),
    JSON.stringify(next),
  );
  const saved = await tool(runner, 'save_run_record', {
    task_id: task.id,
    request_id: randomUUID(),
    transcript: `## 지시\n${title}\n## AI\n했어요`,
    memo: `한 일: ${title}. 남은 일: 없음`,
    memo_by: 'ai',
    resumed: false,
  });
  assert.equal(saved.status, 'saved', JSON.stringify(saved));
  return [task, String(saved.session_id)];
}

const drain = async () => {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
};

/** 이 작업 세션의 정리 요청 (task.task.requested, kind tidy_session) */
const tidyRequests = async (sessionId: string) =>
  (
    await db.sql`
      SELECT payload->>'requestId' AS id FROM platform.outbox
      WHERE topic = 'task.task.requested' AND payload->>'targetId' = ${sessionId}`
  ).map((r) => String(r.id));

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  ok(
    await api.request('PUT', '/api/space', owner, { name: '정리', siteUrl: api.baseUrl, version }),
  );
  runner = String(
    ok(
      await api.request('POST', '/api/devices/runner', owner, {
        requestId: randomUUID(),
        name: `정리 러너 ${randomUUID().slice(0, 6)}`,
      }),
      201,
    ).token,
  );
  ok(
    await api.request('PUT', '/api/ai/claude/token', owner, {
      token: `sk-ant-oat01-${randomUUID()}`,
    }),
  );
  agent = ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: '정리 일꾼',
      tool: 'claude',
      scopes: ['read_public', 'write'],
      approvalActions: [],
    }),
    201,
  );
  const settings = ok(await api.get('/api/tidy/settings', owner));
  ok(
    await api.request('PUT', '/api/tidy/settings', owner, {
      autoTidy: true,
      cadence: 'save',
      version: settings.version ?? 0,
    }),
  );
});
beforeEach(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});
after(() => api.close());

describe('끝난 요청의 작업 세션 정리 (S2)', () => {
  test('완료로 끝난 요청은 그때까지의 버전을 정리한다. 세션 화면에 요청 · 정리 상태 · 메모가 보인다', async () => {
    const [task, sessionId] = await recorded('산책 기록 정리');
    await drain();
    assert.deepEqual(await tidyRequests(sessionId), [], '끝나기 전에는 정리하지 않는다');
    const running = ok(await api.get(`/api/sessions/${sessionId}/work`, owner));
    assert.deepEqual(
      [running.flow, running.revisionCount, running.settledSeq, running.tidyRequestedSeq],
      [`task:${task.id}`, 1, 0, 0],
    );

    const submitted = await tool(runner, 'submit_result', {
      task_id: task.id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '끝' },
    });
    assert.equal(submitted.ok, true, JSON.stringify(submitted));
    await drain();
    assert.deepEqual(await tidyRequests(sessionId), [`tidy:${sessionId}:1`]);
    const work = ok(await api.get(`/api/sessions/${sessionId}/work`, owner));
    assert.deepEqual([work.settledSeq, work.tidyRequestedSeq], [1, 1]);
    assert.deepEqual(
      work.memos.map((m: Json) => [m.agent, m.taskTitle, m.runSeq, m.memo, m.writtenBy]),
      [['정리 일꾼', '산책 기록 정리', 1, '한 일: 산책 기록 정리. 남은 일: 없음', 'ai']],
    );

    // 같은 이벤트가 다시 와도 요청은 하나
    await db.sql`UPDATE platform.outbox SET processed_at = NULL
      WHERE topic = 'task.task.changed' AND payload->>'taskId' = ${task.id}`;
    await drain();
    assert.deepEqual(await tidyRequests(sessionId), [`tidy:${sessionId}:1`]);
  });

  test('취소한 요청은 원문으로만 둔다', async () => {
    const [task, sessionId] = await recorded('예약 찾기');
    const found = ok(await api.get(`/api/tasks/${task.id}`, owner));
    ok(
      await api.request('POST', `/api/tasks/${task.id}/cancel`, owner, {
        version: found.version ?? found.task?.version,
      }),
    );
    await drain();
    assert.deepEqual(await tidyRequests(sessionId), []);
    const work = ok(await api.get(`/api/sessions/${sessionId}/work`, owner));
    assert.deepEqual([work.revisionCount, work.settledSeq], [1, 0]);
    const backlog = ok(await api.request('POST', '/api/tidy/backlog', owner, {}));
    assert.deepEqual(
      await tidyRequests(sessionId),
      [],
      `쌓인 세션 정리에도 빠진다 ${JSON.stringify(backlog)}`,
    );
  });

  test('작업 세션 화면은 관리자만, 사람의 세션이면 404', async () => {
    const [, sessionId] = await recorded('목록 보기');
    assert.equal((await api.get(`/api/sessions/${sessionId}/work`)).status, 403);
    const device = await api.connectDevice(owner, '노트북 · 정리', 'collect');
    const saved = await tool(device, 'save_transcript', {
      request_id: randomUUID(),
      tool: 'claude-code',
      source_session_id: randomUUID(),
      text: '## 사용자\n안녕\n## AI\n안녕하세요',
    });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal((await api.get(`/api/sessions/${saved.session_id}/work`, owner)).status, 404);
  });
});
