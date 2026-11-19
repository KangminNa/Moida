import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';

// 결과 결재 (2차 2단계): 대화 한 회차의 결재는 결과 카드 하나로. 도중 결재는 따로 정하지 못하고 카드에 실린다.
// 승인은 고른 것만 남기고(고른 결재는 승인, 고르지 않은 결재는 반려, 고르지 않은 결과물은 휴지통), 수정 요청은 다음 회차,
// 반려는 결과물을 휴지통으로. 받을 것이 없으면 두 번까지 다시 맡기고, 검토자 짝이 있으면 카드 전에 검토한다. 멈추기는 모두 취소.
// 상대는 늘 대표 (O-2): 결재는 대표가 맡긴 팀장이 올리고, 검토자 짝은 대표에게 붙였다가 테스트 끝에 뗀다.

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

/** 일꾼(outbox)이 할 일을 다 한다: 소식 · 결과 카드 · 카드 뒤의 정리 */
async function drain(): Promise<void> {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

async function tool(token: string, name: string, args: Json = {}): Promise<Json> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
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
const open = async (message: string, more: Json = {}) =>
  ok(
    await api.request('POST', '/api/chats', owner, { requestId: randomUUID(), message, ...more }),
    201,
  );
/** 공간의 대표 (O-2). before에서 첫 대화를 열어 만들어 둔다 */
const lead = async (): Promise<Json> => ok(await api.get('/api/agents/lead', owner)).lead;
/** 대표의 검토자 짝 (null이면 뗀다) */
const pair = async (reviewerId: string | null) => {
  const boss = await lead();
  return api.request('PATCH', `/api/agents/${boss.id}`, owner, {
    reviewerId,
    version: boss.version,
  });
};
const detail = async (id: string) => ok(await api.get(`/api/chats/${id}`, owner));
const decide = (card: Json, decision: string, more: Json = {}) =>
  api.request('POST', `/api/approvals/${card.id}/decide`, owner, {
    version: card.version,
    decision,
    ...more,
  });

/** 러너가 빌릴 수 있는 일을 모두 빌린다 */
async function jobs(): Promise<Json[]> {
  return (await tool(runner, 'next_jobs', { limit: 5 })).jobs ?? [];
}

/** 이 대화의 회차 일 하나를 빌린다 */
async function turnJob(chatId: string): Promise<Json> {
  const job = (await jobs()).find((j) => j.task.payload.chat?.chatId === chatId);
  assert.ok(job, '대화의 일이 빌려지지 않았다');
  return job;
}

/** 대표의 회차가 팀장(member)에게 맡긴 일을 빌린다: 결재는 팀이 올린다 (대표는 승인 동작이 없다) */
async function teamJob(chatId: string, member: Json, title = '팀의 일'): Promise<Json> {
  const turn = await turnJob(chatId);
  await tool(turn.run_token, 'delegate_task', {
    subtasks: [{ request_id: randomUUID(), to_agent_id: member.id, title, instruction: title }],
  });
  const job = (await jobs()).find((j) => j.task.title === title);
  assert.ok(job, '팀장의 일이 빌려지지 않았다');
  return job;
}

/** 일이 만든 결과물 (러너가 올린 것처럼 실행에 묶어 넣는다) */
async function made(job: Json, name: string): Promise<string> {
  const [run] =
    await db.sql`SELECT id, space_id FROM task.task_runs WHERE task_id = ${job.task.id}`;
  const [row] = await db.sql`
    INSERT INTO task.outputs (space_id, task_id, run_id, name, kind, mime, size_bytes, blob_hash)
    VALUES (${run?.space_id}, ${job.task.id}, ${run?.id}, ${name}, 'document', 'text/html', 10, ${'b'.repeat(64)})
    RETURNING id`;
  return String(row?.id);
}

const done = (job: Json, text = '끝났어요') =>
  tool(runner, 'submit_result', {
    task_id: job.task.id,
    request_id: randomUUID(),
    status: 'done',
    result: { text },
  });

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '카드', siteUrl: api.baseUrl, version });
  runner = await api.connectDevice(owner, 'card-runner');
  const { devices } = ok(await api.get('/api/devices', owner)) as { devices: Json[] };
  const device = devices.find((d) => d.name === 'card-runner') as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...device.scopes, 'run'],
      version: device.version,
    }),
  );
  await open('대표를 만드는 첫 대화');
});
// 이 파일이 만든 결과물(시험의 해시)과 다른 도구 에이전트는 치운다: 같은 공간을 쓰는 뒤 파일(결과물 목록 · 사용량)이 보지 않게
after(async () => {
  await db.sql`DELETE FROM task.outputs WHERE blob_hash = ${'b'.repeat(64)}`;
  await db.sql`
    UPDATE task.agents SET deleted_at = now()
    WHERE tool = 'codex' AND name LIKE '다른 도구 %' AND deleted_at IS NULL`;
  await api.close();
});

beforeEach(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});

describe('결과 카드', () => {
  test('회차가 끝나면 결과물이 카드 하나에 실리고, 승인하면 고른 것만 남는다. 방문자는 정하지 못한다', async () => {
    const chat = await open('자료 두 개 만들어 줘');
    const job = await turnJob(chat.id);
    const keep = await made(job, '남길 것.html');
    const drop = await made(job, '버릴 것.html');
    await done(job);
    await drain();
    const card = (await detail(chat.id)).card;
    assert.deepEqual(
      card.items.map((i: Json) => [i.kind, i.label]),
      [
        ['output', '남길 것.html'],
        ['output', '버릴 것.html'],
      ],
    );
    assert.deepEqual([card.deliver, card.passed, card.review], [null, true, null]);
    const inbox = ok(await api.get('/api/approvals?status=pending', owner)).approvals as Json[];
    assert.ok(inbox.some((a) => a.id === card.id && a.action === 'task.chat.result'));
    const { chats } = ok(await api.get('/api/chats', owner));
    assert.equal(chats.find((c: Json) => c.id === chat.id)?.state, 'waiting_approval');

    const visitor = await api.request(
      'POST',
      `/api/approvals/${card.id}/decide`,
      TestUser.visitor,
      {
        version: card.version,
        decision: 'approve',
      },
    );
    assert.equal(visitor.status, 403);
    assert.equal((await decide(card, 'approve', { picked: [randomUUID()] })).status, 422);
    ok(await decide(card, 'approve', { picked: [keep] }));
    const rows = await db.sql`
      SELECT id, deleted_at FROM task.outputs WHERE id = ANY(${[keep, drop]}::uuid[])`;
    const trashed = new Map(rows.map((r) => [String(r.id), r.deleted_at !== null]));
    assert.deepEqual([trashed.get(keep), trashed.get(drop)], [false, true]);
    await drain();
    assert.equal(
      (await detail(chat.id)).card,
      null,
      '정한 카드는 사라지고 같은 결과물은 다시 실리지 않는다',
    );
  });

  test('대화의 일에서 올린 결재는 따로 정하지 못하고 카드에 실린다. 고르지 않은 결재는 반려된다', async () => {
    const sender = await agent('결재 팀장', { approvalActions: ['qa.post.send'] });
    const chat = await open('보내 줘');
    const job = await teamJob(chat.id, sender);
    const output = await made(job, '보낼 글.html');
    const asked = await tool(job.run_token, 'request_approval', {
      request_id: randomUUID(),
      action: 'qa.post.send',
      target_kind: 'post',
      target_id: randomUUID(),
      target_version: 1,
      note: '보내도 될까요',
    });
    const alone = ok(await api.get(`/api/approvals/${asked.approval_id}`, owner));
    assert.equal(
      (await decide(alone, 'approve')).status,
      422,
      '대화의 결재는 결과 카드에서 정한다',
    );
    const inbox = ok(await api.get('/api/approvals?status=pending', owner)).approvals as Json[];
    assert.equal(
      inbox.some((a) => a.id === asked.approval_id),
      false,
      '목록에는 카드만 보인다',
    );
    await drain();
    const room = await detail(chat.id);
    assert.equal(room.turns[0].approvalIds.length, 0);
    assert.deepEqual(
      room.card.items.map((i: Json) => [i.kind, i.id]),
      [
        ['action', asked.approval_id],
        ['output', output],
      ],
      '결재를 기다리며 가라앉은 회차도 카드가 된다',
    );
    ok(await decide(room.card, 'approve', { picked: [output] }));
    const [action] =
      await db.sql`SELECT status FROM task.approvals WHERE id = ${asked.approval_id}`;
    const [task] = await db.sql`SELECT status FROM task.tasks WHERE id = ${job.task.id}`;
    assert.deepEqual([action?.status, task?.status], ['rejected', 'cancelled']);
  });

  test('수정 요청은 메모를 다음 회차로 보내고 결과물은 남긴다. 반려는 결과물을 휴지통으로', async () => {
    const chat = await open('초안 써 줘');
    const job = await turnJob(chat.id);
    const draft = await made(job, '초안.html');
    await done(job);
    await drain();
    const card = (await detail(chat.id)).card;
    assert.equal((await decide(card, 'revise')).status, 422, '고칠 내용이 있어야 한다');
    ok(await decide(card, 'revise', { note: '제목을 더 짧게' }));
    await drain();
    const room = await detail(chat.id);
    assert.deepEqual(
      [room.chat.turns, room.turns.at(-1).message, room.card],
      [2, '제목을 더 짧게', null],
    );
    const [kept] = await db.sql`SELECT deleted_at FROM task.outputs WHERE id = ${draft}`;
    assert.equal(kept?.deleted_at, null);

    const second = await turnJob(chat.id);
    const again = await made(second, '고친 초안.html');
    await done(second);
    await drain();
    ok(await decide((await detail(chat.id)).card, 'reject'));
    const [gone] = await db.sql`SELECT deleted_at FROM task.outputs WHERE id = ${again}`;
    assert.notEqual(gone?.deleted_at, null);
  });

  test('받을 것이 없으면 두 번까지 다시 맡기고, 그다음은 떨어진 채로 끝난다. 있으면 검사를 통과한 카드', async () => {
    assert.equal(
      (
        await api.request('POST', '/api/chats', owner, {
          requestId: randomUUID(),
          message: 'x',
          deliver: 'pdf',
        })
      ).status,
      422,
    );
    const chat = await open('발표 자료 만들어 줘', { deliver: 'html' });
    for (const turn of [1, 2, 3]) {
      await done(await turnJob(chat.id), `${turn}번째 답`);
      await drain();
    }
    const room = await detail(chat.id);
    assert.deepEqual(
      room.turns.map((t: Json) => t.fix),
      [false, true, true],
    );
    assert.match(room.turns[1].message, /html/);
    assert.equal(room.chat.turns, 3, '두 번 다시 맡긴 뒤에는 멈춘다');
    assert.equal(room.card, null, '실을 것이 없으면 카드도 없다');

    const next = await open('페이지 만들어 줘', { deliver: 'html' });
    const job = await turnJob(next.id);
    await made(job, 'index.html');
    await done(job);
    await drain();
    const after = await detail(next.id);
    assert.deepEqual([after.card.deliver, after.card.passed], ['html', true]);
    assert.equal(
      after.chat.turns,
      1,
      '카드에 실은 뒤에는 받을 것이 빠졌다고 보지 않는다 (다시 맡기지 않음)',
    );
  });

  test('검토자 짝: 다른 도구의 에이전트만. 회차가 끝나면 검토가 먼저 돌고, 그 의견이 카드에 실린다', async () => {
    const boss = await lead();
    const same = await agent('같은 도구');
    const other = await agent('다른 도구', { tool: 'codex' });
    assert.equal((await pair(same.id)).status, 422);
    assert.equal((await pair(boss.id)).status, 422);
    const paired = ok(await pair(other.id));
    assert.equal(paired.reviewerId, other.id);

    const chat = await open('보고서 써 줘');
    const job = await turnJob(chat.id);
    await made(job, '보고서.html');
    await done(job, '보고서를 썼어요');
    await drain();
    assert.equal((await detail(chat.id)).card, null, '검토 전에는 카드가 없다');
    const review = (await jobs()).find((j) => j.task.payload.chat?.review === true) as Json;
    assert.equal(review.agent.id, other.id);
    assert.match(review.instruction, /보고서를 썼어요/);
    assert.match(review.instruction, /보고서\.html/);
    await done(review, '그대로 승인. 근거가 충분해요');
    await drain();
    const room = await detail(chat.id);
    assert.deepEqual(
      [room.card.review.verdict, room.card.review.summary],
      ['unknown', '그대로 승인. 근거가 충분해요'],
      'JSON 판정이 아닌 옛 답은 글 그대로',
    );
    assert.ok(room.news.some((n: Json) => n.kind === 'review'));
    ok(await pair(null));
  });

  test('검증 고리: 검토가 고칠 것을 남기면 한 번 다시 맡기고, 다시 검토한 뒤 카드. 고친 결과물만 싣는다', async () => {
    const other = await agent('다른 도구', { tool: 'codex' });
    ok(await pair(other.id));
    const judged = (verdict: string) =>
      JSON.stringify({
        verdict,
        summary: '출처가 없어요',
        checklist: [
          { item: '보고서 파일', ok: true, note: '' },
          { item: '출처 링크', ok: false, note: '없음' },
        ],
        fixes: ['본문 끝에 출처 링크를 단다'],
        skip: [],
      });
    const reviewJob = async () =>
      (await jobs()).find(
        (j) => j.task.payload.chat?.chatId === chat.id && j.task.payload.chat?.review === true,
      ) as Json;

    const chat = await open('보고서 써 줘');
    const first = await turnJob(chat.id);
    const old = await made(first, '보고서.html');
    await done(first, '보고서를 썼어요');
    await drain();
    await done(await reviewJob(), judged('fix'));
    await drain();

    let room = await detail(chat.id);
    assert.equal(room.card, null, '고치는 동안에는 카드가 없다');
    assert.deepEqual(
      room.turns.map((t: Json) => [t.fix, t.fixBy]),
      [
        [false, null],
        [true, 'review'],
      ],
    );
    assert.match(room.turns[1].message, /본문 끝에 출처 링크를 단다/);
    assert.match(room.turns[1].message, /출처 링크 \(없음\)/, '채우지 못한 완료 조건도 싣는다');
    assert.ok(room.news.some((n: Json) => n.kind === 'review' && /^고칠 것 있음/.test(n.text)));

    const second = await turnJob(chat.id);
    const fixed = await made(second, '보고서.html');
    const bad = await api.mcp(runner, 'tools/call', {
      name: 'submit_result',
      arguments: {
        task_id: second.task.id,
        request_id: randomUUID(),
        status: 'done',
        result: { text: 'x', checks: [{ name: '검사', ok: 'yes' }] },
      },
    });
    assert.equal((bad.json() as Json).result.isError, true, '검사의 모양이 틀리면 받지 않는다');
    await tool(runner, 'submit_result', {
      task_id: second.task.id,
      request_id: randomUUID(),
      status: 'done',
      result: {
        text: '출처를 달았어요',
        checks: [{ name: 'index.html 있음', ok: true, how: '통과', retried: true }],
      },
    });
    await drain();
    await done(await reviewJob(), judged('fix'));
    await drain();

    room = await detail(chat.id);
    assert.equal(room.chat.turns, 2, '검토 반영은 한 번까지');
    assert.deepEqual(
      [room.card.review.verdict, room.card.review.fixes, room.card.fixed],
      ['fix', ['본문 끝에 출처 링크를 단다'], { deliver: 0, review: 1 }],
    );
    assert.deepEqual(
      room.card.review.checklist.map((c: Json) => c.ok),
      [true, false],
    );
    assert.deepEqual(
      room.card.items.map((i: Json) => [i.id, i.checks]),
      [[fixed, [{ name: 'index.html 있음', ok: true, how: '통과', retried: true }]]],
      '같은 이름의 앞 결과물은 싣지 않는다',
    );
    const [gone] = await db.sql`SELECT deleted_at FROM task.outputs WHERE id = ${old}`;
    assert.ok(gone?.deleted_at, '앞 결과물은 휴지통으로');
    ok(await pair(null));
  });

  test('검증 고리: 결재만 기다리는 회차도 카드 전에 검토한다 (고칠 것이 나와도 다시 맡기지 않고 카드에)', async () => {
    const sender = await agent('결재 고리', { approvalActions: ['qa.post.send'] });
    const other = await agent('다른 도구', { tool: 'codex' });
    ok(await pair(other.id));
    const chat = await open('보내 줘');
    const job = await teamJob(chat.id, sender);
    await tool(job.run_token, 'request_approval', {
      request_id: randomUUID(),
      action: 'qa.post.send',
      target_kind: 'post',
      target_id: randomUUID(),
      target_version: 1,
      note: '보내도 될까요',
    });
    await drain();
    assert.equal((await detail(chat.id)).card, null, '검토 전에는 카드가 없다');
    const review = (await jobs()).find(
      (j) => j.task.payload.chat?.chatId === chat.id && j.task.payload.chat?.review === true,
    ) as Json;
    assert.match(review.instruction, /qa\.post\.send/);
    await done(
      review,
      JSON.stringify({
        verdict: 'fix',
        summary: '받는 사람이 빠졌어요',
        fixes: ['받는 사람을 적는다'],
      }),
    );
    await drain();
    const room = await detail(chat.id);
    assert.equal(room.chat.turns, 1);
    assert.deepEqual(
      [room.card.review.verdict, room.card.fixed, room.card.items.length],
      ['fix', { deliver: 0, review: 0 }, 1],
    );
    ok(await pair(null));
  });

  test('멈추기: 도는 일 · 기다리는 결재 · 카드를 모두 취소한다. 낡은 판은 409', async () => {
    const sender = await agent('멈출 팀장', { approvalActions: ['qa.post.send'] });
    const chat = await open('길게 일해 줘');
    const job = await teamJob(chat.id, sender);
    const asked = await tool(job.run_token, 'request_approval', {
      request_id: randomUUID(),
      action: 'qa.post.send',
      target_kind: 'post',
      target_id: randomUUID(),
      target_version: 1,
    });
    await drain();
    const room = await detail(chat.id);
    assert.ok(room.card);
    assert.equal(
      (await api.request('POST', `/api/chats/${chat.id}/stop`, owner, { version: 999 })).status,
      409,
    );
    ok(
      await api.request('POST', `/api/chats/${chat.id}/stop`, owner, {
        version: room.chat.version,
      }),
    );
    const states = await db.sql`
      SELECT (SELECT status FROM task.tasks WHERE id = ${job.task.id}) AS task,
        (SELECT status FROM task.approvals WHERE id = ${asked.approval_id}) AS action,
        (SELECT status FROM task.approvals WHERE id = ${room.card.id}) AS card`;
    assert.deepEqual(states[0], { task: 'cancelled', action: 'cancelled', card: 'cancelled' });
  });
});
