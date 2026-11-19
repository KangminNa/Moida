import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, type TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';

// 결과물 중심 (O-3, docs/서브나.md 14장): 대표가 회차의 받을 것을 정하고(set_deliver) 서버가 결과 카드에서 본다.
// 없으면 같은 회차를 다시 맡기고(화면용 한 줄 note, 받을 것을 물려받음), 관리자 · 레시피가 정한 값이 먼저다.
// 대화에서 승인한 대화 레시피는 그 대화에 묶여 회차가 쌓인다. 상세에 자동화 목록, 질문(question) · 고를 에이전트(choices)는 없다.

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let runner: string;
let worker: OutboxWorker;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function drain(): Promise<void> {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

/** MCP 도구 한 번. 실패면 { error: 글 } */
async function call(token: string, name: string, args: Json = {}): Promise<Json> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as {
    isError?: boolean;
    structuredContent?: Json;
    content?: { text: string }[];
  };
  if (result.isError) return { error: result.content?.map((c) => c.text).join(' ') ?? '' };
  return result.structuredContent ?? {};
}
async function tool(token: string, name: string, args: Json = {}): Promise<Json> {
  const answer = await call(token, name, args);
  assert.equal(answer.error, undefined, JSON.stringify(answer));
  return answer;
}

const open = async (message: string, more: Json = {}) =>
  ok(
    await api.request('POST', '/api/chats', owner, { requestId: randomUUID(), message, ...more }),
    201,
  );
const detail = async (id: string) => ok(await api.get(`/api/chats/${id}`, owner));
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

async function jobs(): Promise<Json[]> {
  return (await tool(runner, 'next_jobs', { limit: 5 })).jobs ?? [];
}
async function turnJob(chatId: string, turn = 1): Promise<Json> {
  for (let i = 0; i < 5; i++) {
    const job = (await jobs()).find(
      (j) => j.task.payload.chat?.chatId === chatId && j.task.payload.chat?.turn === turn,
    );
    if (job) return job;
    await drain();
  }
  throw new Error(`대화의 ${turn}회차를 빌리지 못했다`);
}
const done = (job: Json, text = '끝났어요') =>
  tool(runner, 'submit_result', {
    task_id: job.task.id,
    request_id: randomUUID(),
    status: 'done',
    result: { text },
  });
async function made(job: Json, name: string): Promise<void> {
  const [run] =
    await db.sql`SELECT id, space_id FROM task.task_runs WHERE task_id = ${job.task.id}`;
  await db.sql`
    INSERT INTO task.outputs (space_id, task_id, run_id, name, kind, mime, size_bytes, blob_hash)
    VALUES (${run?.space_id}, ${job.task.id}, ${run?.id}, ${name}, 'document', 'text/html', 10, ${'d'.repeat(64)})`;
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '받을 것', siteUrl: api.baseUrl, version });
  runner = await api.connectDevice(owner, 'deliver-runner');
  const { devices } = ok(await api.get('/api/devices', owner)) as { devices: Json[] };
  const device = devices.find((d) => d.name === 'deliver-runner') as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...device.scopes, 'run'],
      version: device.version,
    }),
  );
});
after(async () => {
  await db.sql`DELETE FROM task.outputs WHERE blob_hash = ${'d'.repeat(64)}`;
  await db.sql`
    UPDATE task.schedules SET enabled = false, next_run_at = NULL WHERE title LIKE '아침 브리핑 %'`;
  await api.close();
});
beforeEach(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});

describe('회차의 받을 것 (O-3 set_deliver)', () => {
  test('대표가 정하면 회차에 남고 같은 값은 다시 불러도 된다. 다른 값 · 없는 값은 막힌다', async () => {
    const chat = await open('이번 주 소식을 페이지로 만들어 줘');
    const job = await turnJob(chat.id);
    assert.deepEqual(
      await tool(job.run_token, 'set_deliver', { deliver: 'html', note: '한 장짜리 페이지' }),
      { deliver: 'html', by: 'lead' },
    );
    assert.deepEqual(await tool(job.run_token, 'set_deliver', { deliver: 'html' }), {
      deliver: 'html',
      by: 'lead',
    });
    assert.match(
      (await call(job.run_token, 'set_deliver', { deliver: 'file' })).error,
      /이번 회차의 받을 것은 이미 정했어요 \(html\)/,
    );
    assert.ok((await call(job.run_token, 'set_deliver', { deliver: 'pdf' })).error);
    const [turn] = (await detail(chat.id)).turns;
    assert.deepEqual([turn.deliver, turn.deliverNote], ['html', '한 장짜리 페이지']);
  });

  test('관리자가 대화에 정한 받을 것이 있으면 그 값만 받는다 (by admin)', async () => {
    const chat = await open('글로 써 줘', { deliver: 'blog' });
    const job = await turnJob(chat.id);
    assert.match(
      (await call(job.run_token, 'set_deliver', { deliver: 'html' })).error,
      /관리자가 정했어요 \(blog\)/,
    );
    assert.deepEqual(await tool(job.run_token, 'set_deliver', { deliver: 'blog' }), {
      deliver: 'blog',
      by: 'admin',
    });
  });

  test('대표의 회차가 아니면(팀장에게 맡긴 일) 정하지 못한다', async () => {
    const head = await agent('조사 팀장');
    const chat = await open('조사해 줘');
    const job = await turnJob(chat.id);
    await tool(job.run_token, 'delegate_task', {
      subtasks: [
        { request_id: randomUUID(), to_agent_id: head.id, title: '조사', instruction: '조사' },
      ],
    });
    const sub = (await jobs()).find((j) => j.task.title === '조사') as Json;
    assert.match(
      (await call(sub.run_token, 'set_deliver', { deliver: 'file' })).error,
      /대화 회차를 맡은 대표만 정해요/,
    );
  });

  test('정한 받을 것이 결과에 없으면 같은 회차를 다시 맡긴다: 화면용 한 줄 · 받을 것을 물려받음 · 작업 제목', async () => {
    const chat = await open('보고서 파일로 줘');
    const job = await turnJob(chat.id);
    await tool(job.run_token, 'set_deliver', { deliver: 'file' });
    await done(job, '정리했어요');
    await drain();
    const room = await detail(chat.id);
    assert.deepEqual(
      room.turns.map((t: Json) => [t.turn, t.fix, t.note, t.deliver]),
      [
        [1, false, null, 'file'],
        [2, true, '받을 것(파일)이 없어 다시 맡김', 'file'],
      ],
    );
    const [task] = await db.sql`SELECT title FROM task.tasks WHERE id = ${room.turns[1].taskId}`;
    assert.equal(task?.title, '대화 · 받을 것(파일)이 없어 다시 맡김');
    // 다시 맡긴 회차가 파일을 내면 카드에 실리고 검사를 통과한다
    const again = await turnJob(chat.id, 2);
    await made(again, '보고서.md');
    await done(again);
    await drain();
    const card = (await detail(chat.id)).card;
    assert.deepEqual([card.deliver, card.passed], ['file', true]);
  });

  test('answer(짧은 답)는 검사하지 않는다: 결과물 없이 끝나도 다시 맡기지 않는다', async () => {
    const chat = await open('어제 브리핑 제목만 알려 줘');
    const job = await turnJob(chat.id);
    await tool(job.run_token, 'set_deliver', { deliver: 'answer' });
    await done(job, '"HBM 공급 부족"이에요');
    await drain();
    const room = await detail(chat.id);
    assert.deepEqual([room.turns.length, room.state, room.card], [1, 'done', null]);
  });
});

describe('대화로 자동화 (O-3)', () => {
  test('대표가 대화에서 올린 대화 레시피를 승인하면 그 대화에 묶이고, 돌 때마다 그 대화에 회차가 쌓인다', async () => {
    const chat = await open('매일 아침 AI 소식 브리핑해 줘');
    const job = await turnJob(chat.id);
    await tool(job.run_token, 'set_deliver', { deliver: 'setting' });
    const title = `아침 브리핑 ${randomUUID().slice(0, 6)}`;
    const proposed = await tool(job.run_token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'schedule',
      op: 'create',
      fields: {
        title,
        enabled: true,
        mode: 'daily',
        at_time: '08:00',
        time_zone: 'Asia/Seoul',
        instruction: 'AI 소식을 브리핑한다',
        destination: 'chat',
        deliver: 'answer',
        daily_max: 1,
      },
      note: '매일 아침 브리핑하려고',
    });
    // 제안한 회차는 승인을 기다린다: 결재만 남아 가라앉으면 카드가 생긴다
    await drain();
    const card = (await detail(chat.id)).card;
    assert.deepEqual([card.deliver, card.passed], ['setting', true]);
    ok(
      await api.request('POST', `/api/approvals/${card.id}/decide`, owner, {
        version: card.version,
        decision: 'approve',
        picked: [proposed.approval_id],
      }),
    );
    await drain();
    const [schedule] = await db.sql`
      SELECT id, version, chat_id FROM task.schedules WHERE title = ${title}`;
    assert.equal(schedule?.chat_id, chat.id, '대화에 묶인다');
    const room = await detail(chat.id);
    assert.deepEqual(
      room.automations.map((a: Json) => [a.title, a.enabled, a.mode, a.atTime]),
      [[title, true, 'daily', '08:00']],
    );
    assert.equal('question' in room, false, '질문 칸은 없다 (O-2에서 지움)');

    ok(
      await api.request('POST', `/api/schedules/${schedule?.id}/run`, owner, {
        version: schedule?.version,
      }),
    );
    const after = await detail(chat.id);
    const last = after.turns.at(-1);
    assert.equal(after.chat.id, chat.id);
    assert.deepEqual([last.turn, last.fix, last.deliver], [2, false, 'answer']);
    const run = await turnJob(chat.id, 2);
    assert.match(
      (await call(run.run_token, 'set_deliver', { deliver: 'file' })).error,
      /이미 정했어요 \(answer\)/,
      '레시피의 받을 것을 대표가 바꾸지 못한다',
    );

    const settings = await tool(run.run_token, 'get_settings', { kind: 'schedules' });
    const mine = (settings.schedules as Json[]).find((s) => s.title === title);
    assert.equal(mine?.chat_id, chat.id, 'get_settings에서 이 대화의 자동화를 찾는다');
  });

  test('agent_updates의 소식 줄에 고를 에이전트(choices)는 없다', async () => {
    const device = await api.connectDevice(owner, 'deliver-news', 'news');
    const { news } = await tool(device, 'agent_updates', {});
    assert.ok((news as Json[]).length > 0);
    assert.ok((news as Json[]).every((u) => !('choices' in u)));
  });
});
