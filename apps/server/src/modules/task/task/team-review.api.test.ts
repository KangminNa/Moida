import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, type TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker, SystemActor } from '../../platform';
import { TaskService } from './task.service';

// 평가가 남는 팀 (2026-11-20, ECC에서 가져옴): 큰 일은 계획 먼저(set_plan) · 주간 팀 점검 · 자동화 건강 검사.
// 점수로 판정 · 두 검수자는 chat-inspect.api.test, 성적표 숫자는 team-roster.test

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let worker: OutboxWorker;
let runner: string;
let reviewer: Json;
let spaceId: string;

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

const agent = async (name: string, more: Json = {}) =>
  ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `${name} ${randomUUID().slice(0, 6)}`,
      tool: 'claude',
      scopes: ['read_public'],
      ...more,
    }),
    201,
  );
const lead = async (): Promise<Json> => ok(await api.get('/api/agents/lead', owner)).lead;
const editLead = async (body: Json) => {
  const boss = await lead();
  return api.request('PATCH', `/api/agents/${boss.id}`, owner, { ...body, version: boss.version });
};
const open = async (message: string) =>
  ok(await api.request('POST', '/api/chats', owner, { requestId: randomUUID(), message }), 201);

async function find(pick: (job: Json) => boolean, what: string): Promise<Json> {
  const jobs: Json[] = (await tool(runner, 'next_jobs', { limit: 5 })).jobs ?? [];
  const job = jobs.find(pick);
  assert.ok(job, `${what}이(가) 빌려지지 않았다`);
  return job;
}

const finish = (job: Json, status: 'done' | 'failed', text: string) =>
  tool(runner, 'submit_result', {
    task_id: job.task.id,
    request_id: randomUUID(),
    status,
    ...(status === 'done' ? { result: { text } } : { error: text }),
  });

const cancelOpen = () => db.sql`
  UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
  WHERE status IN ('queued', 'running', 'waiting')`;

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '평가', siteUrl: api.baseUrl, version });
  runner = await api.connectDevice(owner, 'team-review-runner');
  const { devices } = ok(await api.get('/api/devices', owner)) as { devices: Json[] };
  const device = devices.find((d) => d.name === 'team-review-runner') as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...device.scopes, 'run'],
      version: device.version,
    }),
  );
  await open('대표를 만드는 첫 대화');
  reviewer = await agent('검토자', { tool: 'codex' });
  const [row] = await db.sql`SELECT space_id FROM task.agents WHERE id = ${reviewer.id}`;
  spaceId = String(row?.space_id);
});

after(async () => {
  await editLead({ reviewerId: null });
  await db.sql`UPDATE task.agents SET deleted_at = now() WHERE id = ${reviewer.id}`;
  await api.close();
});

beforeEach(async () => {
  await drain();
  await cancelOpen();
});

describe('평가가 남는 팀', () => {
  test('계획 (set_plan): 한 번만 정하고, 대화에 소식으로 보이며, 검토 지시에 그 완료 조건 · 하지 말 것이 그대로 실린다', async () => {
    ok(await editLead({ reviewerId: reviewer.id }));
    const chat = await open('비교표 하나 만들어 줘');
    const turn = await find((j) => j.task.payload.chat?.chatId === chat.id, '대표의 회차');
    const plan = await tool(turn.run_token, 'set_plan', {
      steps: ['조사 → 리서처', '표 → 제작자'],
      criteria: ['표에 5개 행'],
      must_not: ['메일 보내기'],
    });
    assert.deepEqual(
      [plan.fixed, plan.criteria, plan.must_not],
      [true, ['표에 5개 행'], ['메일 보내기']],
    );
    const again = await call(turn.run_token, 'set_plan', { criteria: ['다른 조건'] });
    assert.equal((again.json() as Json).result.isError, true, '완료 조건은 바꿀 수 없다');
    const empty = await call(turn.run_token, 'set_plan', { criteria: [] });
    assert.equal((empty.json() as Json).result.isError, true);
    const room = ok(await api.get(`/api/chats/${chat.id}`, owner));
    assert.ok(
      room.news.some(
        (n: Json) => n.kind === 'decision' && /계획을 정했어요[\s\S]*표에 5개 행/.test(n.text),
      ),
      JSON.stringify(room.news),
    );

    // 회차의 결과물 하나 (결과 카드에 실을 것이 있어야 검토가 돈다)
    const [run] =
      await db.sql`SELECT id, space_id FROM task.task_runs WHERE task_id = ${turn.task.id}`;
    await db.sql`
      INSERT INTO task.outputs (space_id, task_id, run_id, name, kind, mime, size_bytes, blob_hash)
      VALUES (${run?.space_id}, ${turn.task.id}, ${run?.id}, '비교표.html', 'document', 'text/html', 10, ${'c'.repeat(64)})`;
    await finish(turn, 'done', '표를 만들었어요');
    await drain();
    const review = await find(
      (j) => j.task.payload.chat?.chatId === chat.id && j.task.payload.chat?.review === true,
      '검토',
    );
    assert.match(review.instruction, /계획에서 정한 완료 조건[^\n]*\n- 표에 5개 행/);
    assert.match(review.instruction, /계획에서 정한 하지 말 것\n- 메일 보내기/);
    // 통과라고 해도 4점 아래 조건이 있으면 고칠 것으로 쌓인다 (회차에 하위 작업이 없으면 대표가 판정받는다)
    await finish(
      review,
      'done',
      JSON.stringify({
        verdict: 'pass',
        summary: '좋아요',
        checklist: [{ item: '표에 5개 행', score: 3, note: '4개뿐' }],
      }),
    );
    await drain();
    const [row] = await db.sql`
      SELECT agent_id, kind, round, verdict, score FROM task.verdicts WHERE task_id = ${review.task.id}`;
    assert.deepEqual(
      [row?.agent_id, row?.kind, row?.round, row?.verdict, row?.score],
      [(await lead()).id, 'review', 1, 'fix', 3],
    );
  });

  test('주간 팀 점검: 대표가 생긴 지 일주일이 넘고 끝난 일이 10개 넘으면 성적표를 실은 일 하나. 열린 동안 · 일주일 안에는 더 없다', async () => {
    const boss = await lead();
    const member = await agent('작가');
    const tasks = api.service(TaskService);
    const system = new SystemActor();
    const reviews = () => db.sql`
      SELECT id, agent_id, instruction, priority, status FROM task.tasks
      WHERE request_id LIKE ${`team-review:${spaceId}:%`} ORDER BY created_at`;
    try {
      for (let i = 0; i < 10; i++)
        ok(
          await api.request('POST', '/api/tasks', owner, {
            requestId: randomUUID(),
            agentId: member.id,
            title: `일 ${i}`,
            instruction: '쓰기',
          }),
          201,
        );
      await db.sql`
        UPDATE task.tasks SET status = 'done', finished_at = now()
        WHERE agent_id = ${member.id} AND status = 'queued'`;
      assert.equal(await tasks.reviewTeam(system, spaceId), null, '막 만든 팀은 일주일 뒤부터');
      await db.sql`UPDATE task.agents SET created_at = now() - interval '8 days' WHERE id = ${boss.id}`;
      assert.ok(await tasks.reviewTeam(system, spaceId));
      const [made] = await reviews();
      assert.equal(made?.agent_id, boss.id);
      assert.equal(made?.priority, -5);
      assert.match(String(made?.instruction), /^# 주간 팀 점검/);
      assert.match(
        String(made?.instruction),
        new RegExp(`${member.name} \\(agent_id: ${member.id}\\)[^\\n]*\\n  끝낸 일 10`),
      );
      assert.equal(await tasks.reviewTeam(system, spaceId), null, '열린 점검이 있으면 더 없다');
      await db.sql`UPDATE task.tasks SET status = 'done', finished_at = now() WHERE id = ${made?.id}`;
      assert.equal(await tasks.reviewTeam(system, spaceId), null, '일주일 안에는 더 없다');
      assert.equal((await reviews()).length, 1);
    } finally {
      await db.sql`
        UPDATE task.tasks SET status = 'cancelled', request_id = request_id || ':before'
        WHERE request_id LIKE ${`team-review:${spaceId}:%`} AND request_id NOT LIKE '%:before'`;
      await db.sql`UPDATE task.agents SET created_at = now() WHERE id = ${boss.id}`;
      await db.sql`UPDATE task.agents SET deleted_at = now() WHERE id = ${member.id}`;
    }
  });

  test('자동화 건강 검사: 레시피의 일이 3번 잇달아 실패하면 레시피를 끄고 바로 알린다. 사람이 멈춘 것은 세지 않는다', async () => {
    const member = await agent('일꾼');
    const made = ok(
      await api.request('POST', '/api/schedules', owner, {
        requestId: randomUUID(),
        title: `실패하는 자동화 ${randomUUID().slice(0, 6)}`,
        enabled: true,
        mode: 'daily',
        atTime: '09:30',
        weekdays: [1, 2, 3, 4, 5],
        timeZone: 'Asia/Seoul',
        agentId: member.id,
        instruction: '확인해 주세요',
        dailyMax: 10,
      }),
      201,
    );
    const schedule = async () =>
      (ok(await api.get('/api/schedules', owner)).schedules as Json[]).find(
        (s) => s.id === made.id,
      ) as Json;
    const runOnce = async (status: 'done' | 'failed') => {
      const current = await schedule();
      ok(
        await api.request('POST', `/api/schedules/${made.id}/run`, owner, {
          version: current.version,
        }),
      );
      const job = await find(
        (j) => j.task.agent_id === member.id || j.agent?.id === member.id,
        '자동화의 일',
      );
      await finish(job, status, status === 'failed' ? '사이트가 열리지 않아요' : '했어요');
      await drain();
    };
    try {
      await runOnce('failed');
      await runOnce('failed');
      assert.equal((await schedule()).enabled, true, '두 번까지는 그대로');
      await runOnce('failed');
      assert.equal((await schedule()).enabled, false, '세 번 잇달아 실패하면 끈다');
      const { notifications } = ok(await api.get('/api/notifications', owner));
      const notice = (notifications as Json[]).find(
        (n) => n.kind === 'task.schedule.stopped' && String(n.title).includes(made.title),
      );
      assert.match(String(notice?.title), /3번 잇달아 실패해 껐어요/);
      assert.equal(notice?.severity, 'immediate');
    } finally {
      await db.sql`UPDATE task.agents SET deleted_at = now() WHERE id = ${member.id}`;
    }
  });
});
