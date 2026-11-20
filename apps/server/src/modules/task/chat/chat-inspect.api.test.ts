import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';

// 검수 (기획서 결정 2026-11-20, 원칙 7): 대표가 검수 승인을 켜면 대화의 일에서 올라온 앱 안의 공개(글 · 앱 화면)는
// 대표의 검토자 짝이 먼저 본다. 통과면 검수자가 승인해 바로 공개되고(관리자의 카드에 실리지 않는다), 고칠 것이면
// 올린 팀에게 돌려보내 다시 올리면 다시 검수, 그 밖이면 검수 의견을 붙여 관리자의 결과 카드로 넘긴다.

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let runner: string;
let worker: OutboxWorker;
let menuId: string;
let writer: Json;
let inspector: Json;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function drain(): Promise<void> {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

async function call(token: string, name: string, args: Json = {}): Promise<ApiResult> {
  return api.mcp(token, 'tools/call', { name, arguments: args });
}

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
const open = async (message: string) =>
  ok(await api.request('POST', '/api/chats', owner, { requestId: randomUUID(), message }), 201);
const lead = async (): Promise<Json> => ok(await api.get('/api/agents/lead', owner)).lead;
const editLead = async (body: Json) => {
  const boss = await lead();
  return api.request('PATCH', `/api/agents/${boss.id}`, owner, { ...body, version: boss.version });
};
const detail = async (id: string) => ok(await api.get(`/api/chats/${id}`, owner));
const approvalRow = async (id: string) =>
  (
    await db.sql`
    SELECT status, decided_by, agent_decided, inspected_at, note, card_id
    FROM task.approvals WHERE id = ${id}`
  )[0] as Json;

async function jobs(): Promise<Json[]> {
  return (await tool(runner, 'next_jobs', { limit: 5 })).jobs ?? [];
}

async function find(pick: (job: Json) => boolean, what: string): Promise<Json> {
  const job = (await jobs()).find(pick);
  assert.ok(job, `${what}이(가) 빌려지지 않았다`);
  return job;
}

const done = (job: Json, text: string) =>
  tool(runner, 'submit_result', {
    task_id: job.task.id,
    request_id: randomUUID(),
    status: 'done',
    result: { text },
  });

/** 대표가 글쓰기 팀장에게 맡기고, 팀장이 초안을 써서 공개를 올린다 */
async function writeAndAsk(chatId: string) {
  const turn = await find((j) => j.task.payload.chat?.chatId === chatId, '대표의 회차');
  const title = `검수할 글 ${randomUUID().slice(0, 6)}`;
  await tool(turn.run_token, 'delegate_task', {
    subtasks: [{ request_id: randomUUID(), to_agent_id: writer.id, title, instruction: title }],
  });
  const job = await find((j) => j.task.title === title, '팀장의 일');
  const saved = await tool(job.run_token, 'blog_save_draft', {
    request_id: randomUUID(),
    title,
    body_md: '처음 쓴 본문',
    menu_id: menuId,
  });
  const asked = await ask(job.run_token, saved);
  return { job, postId: String(saved.post_id), approvalId: String(asked.approval_id) };
}

const ask = (token: string, saved: Json) =>
  tool(token, 'request_approval', {
    request_id: randomUUID(),
    action: 'blog.post.publish',
    target_kind: 'post',
    target_id: saved.post_id,
    target_version: saved.version,
    note: '공개해도 될까요',
  });

const inspectionOf = (approvalId: string) =>
  find((j) => j.task.payload.inspect?.approvalId === approvalId, '검수');

const verdict = (v: string, summary: string, fixes: string[] = []) =>
  JSON.stringify({ verdict: v, summary, checklist: [], fixes, skip: [] });

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '검수', siteUrl: api.baseUrl, version });
  runner = await api.connectDevice(owner, 'inspect-runner');
  const { devices } = ok(await api.get('/api/devices', owner)) as { devices: Json[] };
  const device = devices.find((d) => d.name === 'inspect-runner') as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...device.scopes, 'run'],
      version: device.version,
    }),
  );
  const menu = ok(
    await api.request('POST', '/api/menus', owner, {
      requestId: randomUUID(),
      appId: await api.blogApp(owner),
      kind: 'posts',
      name: `검수 글 ${randomUUID().slice(0, 6)}`,
    }),
    201,
  );
  menuId = menu.id;
  await open('대표를 만드는 첫 대화');
  writer = await agent('글쓰기 팀장', {
    scopes: ['read_public', 'write'],
    approvalActions: ['blog.post.publish'],
  });
  inspector = await agent('검수자', { tool: 'codex' });
});

after(async () => {
  await editLead({ reviewerId: null });
  for (const a of [writer, inspector])
    await db.sql`UPDATE task.agents SET deleted_at = now() WHERE id = ${a.id}`;
  await api.close();
});

const cancelOpen = () => db.sql`
  UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
  WHERE status IN ('queued', 'running', 'waiting')`;

beforeEach(async () => {
  await cancelOpen();
  ok(await editLead({ reviewerId: inspector.id, reviewerApproves: true }));
  // 앞 시험의 대화가 검수 승인이 다시 켜져 검수를 열 수 있다: 남은 이벤트를 다 돌린 뒤 한 번 더 비운다
  await drain();
  await cancelOpen();
});

describe('검수', () => {
  test('검수 승인은 대표에게만, 검토자가 있어야 켠다. 검토자를 떼면 함께 꺼진다', async () => {
    assert.equal((await lead()).reviewerApproves, true);
    const team = await agent('팀장');
    const res = await api.request('PATCH', `/api/agents/${team.id}`, owner, {
      reviewerApproves: true,
      version: team.version,
    });
    assert.equal(res.status, 422, res.text);
    ok(await editLead({ reviewerId: null }));
    assert.equal((await lead()).reviewerApproves, false, '검토자를 떼면 꺼진다');
    assert.equal((await editLead({ reviewerApproves: true })).status, 422, '검토자가 먼저');
    const visitor = await api.request('PATCH', `/api/agents/${team.id}`, undefined, {
      reviewerApproves: true,
      version: team.version,
    });
    assert.ok([401, 403].includes(visitor.status), visitor.text);
  });

  test('통과: 검수자가 그 글만 읽고 승인해 바로 공개된다. 관리자의 카드에는 실리지 않는다', async () => {
    const chat = await open('글 하나 써서 공개해 줘');
    const { job, postId, approvalId } = await writeAndAsk(chat.id);
    await drain();
    assert.equal((await detail(chat.id)).card, null, '검수 중에는 카드가 없다');
    const inspection = await inspectionOf(approvalId);
    assert.equal(inspection.task.agent_id ?? inspection.agent?.id, inspector.id);
    assert.match(inspection.instruction, /공개 전 검수/);
    assert.ok(inspection.instruction.includes(postId), '읽을 글의 id가 지시에 있다');
    // 쓰기 권한이 없어도 검수할 글은 읽고, 다른 글은 읽지 못한다
    const read = await tool(inspection.run_token, 'blog_get_post', { post_id: postId });
    assert.equal(read.id ?? read.post_id, postId);
    const other = await call(inspection.run_token, 'blog_get_post', { post_id: randomUUID() });
    assert.equal((other.json() as Json).result.isError, true);

    await done(inspection, verdict('pass', '시중 글과 견줘 구성 · 말투 모두 괜찮아요'));
    await drain();
    const row = await approvalRow(approvalId);
    assert.deepEqual(
      [row.status, row.decided_by, row.agent_decided, row.inspected_at !== null, row.card_id],
      ['approved', inspector.id, true, true, null],
    );
    const post = ok(await api.get(`/api/posts/${postId}`, owner));
    assert.equal(post.status, 'published', '검수자의 승인으로 공개된다');
    const [task] = await db.sql`SELECT status FROM task.tasks WHERE id = ${job.task.id}`;
    assert.equal(task?.status, 'done');
    const room = await detail(chat.id);
    assert.ok(
      room.news.some((n: Json) => n.kind === 'review' && /^검수 · 그대로 승인/.test(n.text)),
      JSON.stringify(room.news),
    );
  });

  test('고칠 것: 올린 팀에게 돌려보내고, 다시 올리면 앞 의견과 함께 다시 검수. 반려 권함은 관리자의 카드로', async () => {
    const chat = await open('글 하나 써서 공개해 줘');
    const first = await writeAndAsk(chat.id);
    await drain();
    await done(
      await inspectionOf(first.approvalId),
      verdict('fix', 'AI 말투가 남았어요', ['첫 문단의 "~에 대해 알아보겠습니다"를 지운다']),
    );
    await drain();
    const fixed = await approvalRow(first.approvalId);
    assert.deepEqual([fixed.status, fixed.agent_decided], ['revision_requested', true]);
    assert.match(fixed.note, /고칠 것:\n- 첫 문단/);

    // 팀장이 돌려받은 일을 다시 빌려 고치고 다시 올린다
    const again = await find((j) => j.task.id === first.job.task.id, '돌려받은 일');
    assert.match(JSON.stringify(again.task.payload.revisionNote), /첫 문단/);
    const post = ok(await api.get(`/api/posts/${first.postId}`, owner));
    const saved = await tool(again.run_token, 'blog_save_draft', {
      request_id: randomUUID(),
      post_id: first.postId,
      base_version: post.version,
      title: post.title,
      body_md: '고친 본문',
      menu_id: menuId,
    });
    const second = await ask(again.run_token, saved);
    await drain();
    const round = await inspectionOf(String(second.approval_id));
    assert.match(round.instruction, /2번째 검수/);
    assert.match(round.instruction, /앞 검수에서 고쳐 달라고 한 것[\s\S]*첫 문단/);

    await done(round, verdict('reject', '사실 근거가 없어 공개하면 안 돼요'));
    await drain();
    const held = await approvalRow(String(second.approval_id));
    assert.deepEqual(
      [held.status, held.agent_decided, held.inspected_at !== null],
      ['pending', false, true],
    );
    assert.match(held.note, /검수 의견: 반려 권함/);
    // 남은 결재는 지금처럼: 회차 검토 → 관리자의 카드
    const review = await find(
      (j) =>
        j.task.payload.chat?.chatId === chat.id &&
        j.task.payload.chat?.review &&
        !j.task.payload.inspect,
      '회차 검토',
    );
    await done(review, verdict('pass', '카드로'));
    await drain();
    const room = await detail(chat.id);
    assert.ok(
      room.card.items.some((i: Json) => i.kind === 'action' && i.id === second.approval_id),
      JSON.stringify(room.card),
    );
  });

  test('검수 승인을 끄면 검수하지 않고 지금처럼 관리자의 카드로 간다', async () => {
    ok(await editLead({ reviewerApproves: false }));
    const chat = await open('글 하나 써서 공개해 줘');
    const { approvalId } = await writeAndAsk(chat.id);
    await drain();
    const listed = await jobs();
    assert.equal(
      listed.some((j) => j.task.payload.inspect?.approvalId === approvalId),
      false,
      '검수 작업이 없다',
    );
    const row = await approvalRow(approvalId);
    assert.deepEqual([row.status, row.inspected_at], ['pending', null]);
  });

  test('점수로 판정 (2026-11-20): 고쳐 왔는데 점수가 오르지 않으면 한도 전이라도 관리자에게. 판정은 점수와 함께 쌓인다', async () => {
    const scored = (score: number) =>
      JSON.stringify({
        verdict: 'fix',
        summary: 'AI 말투',
        checklist: [{ item: '말투', score, note: '뻔한 첫머리' }],
        fixes: ['첫 문단을 고친다'],
      });
    const chat = await open('글 하나 써서 공개해 줘');
    const first = await writeAndAsk(chat.id);
    await drain();
    await done(await inspectionOf(first.approvalId), scored(2));
    await drain();
    assert.equal((await approvalRow(first.approvalId)).status, 'revision_requested');
    const again = await find((j) => j.task.id === first.job.task.id, '돌려받은 일');
    const post = ok(await api.get(`/api/posts/${first.postId}`, owner));
    const saved = await tool(again.run_token, 'blog_save_draft', {
      request_id: randomUUID(),
      post_id: first.postId,
      base_version: post.version,
      title: post.title,
      body_md: '조금 고친 본문',
      menu_id: menuId,
    });
    const second = String((await ask(again.run_token, saved)).approval_id);
    await drain();
    await done(await inspectionOf(second), scored(2));
    await drain();
    const held = await approvalRow(second);
    assert.deepEqual([held.status, held.agent_decided], ['pending', false], '관리자에게 넘긴다');
    assert.match(held.note, /고쳐도 점수가 오르지 않음 \(2점 → 2점\)/);
    const rows = await db.sql`
      SELECT round, verdict, score, low, kind FROM task.verdicts
      WHERE agent_id = ${writer.id} AND target LIKE ${`inspect:${chat.id}:%`} ORDER BY round`;
    assert.deepEqual(
      rows.map((r) => [r.kind, r.round, r.verdict, r.score, r.low]),
      [
        ['inspect', 1, 'fix', 2, 2],
        ['inspect', 2, 'fix', 2, 2],
      ],
    );
    // 성적표: 팀원 줄(next_jobs)과 팀 화면(api/usage)이 같은 숫자를 본다
    const usage = ok(await api.get('/api/usage', owner)).agents.find(
      (a: Json) => a.id === writer.id,
    );
    assert.equal(usage.scorecard.days, 30);
    assert.ok(
      usage.scorecard.judged >= 1 && usage.scorecard.avgFixes !== null,
      JSON.stringify(usage),
    );
  });

  test('두 검수자 (2026-11-20): 둘 다 통과해야 승인, 하나만 끝나면 기다린다. 두 번째는 검토자와 다른 AI 도구만', async () => {
    const same = await agent('같은 도구', { tool: 'codex' });
    assert.equal((await editLead({ secondInspectorId: same.id })).status, 422);
    const second = await agent('두 번째 검수자');
    ok(await editLead({ secondInspectorId: second.id }));
    assert.equal((await lead()).secondInspectorId, second.id);
    try {
      const chat = await open('글 하나 써서 공개해 줘');
      const { postId, approvalId } = await writeAndAsk(chat.id);
      await drain();
      const both = (await jobs()).filter((j) => j.task.payload.inspect?.approvalId === approvalId);
      const by = (id: string) => both.find((j) => (j.task.agent_id ?? j.agent?.id) === id);
      assert.equal(both.length, 2, '검수자마다 하나');
      await done(by(second.id) as Json, verdict('pass', '두 번째도 괜찮아요'));
      await drain();
      assert.deepEqual(
        [(await approvalRow(approvalId)).status, (await approvalRow(approvalId)).inspected_at],
        ['pending', null],
        '하나만 끝나면 기다린다',
      );
      await done(by(inspector.id) as Json, verdict('pass', '첫 검수도 괜찮아요'));
      await drain();
      const row = await approvalRow(approvalId);
      assert.deepEqual([row.status, row.decided_by], ['approved', inspector.id]);
      assert.match(row.note, /검수 1: 첫 검수도 괜찮아요 \/ 검수 2: 두 번째도 괜찮아요/);
      assert.equal(ok(await api.get(`/api/posts/${postId}`, owner)).status, 'published');
    } finally {
      ok(await editLead({ secondInspectorId: null }));
      for (const a of [same, second])
        await db.sql`UPDATE task.agents SET deleted_at = now() WHERE id = ${a.id}`;
    }
  });
});
