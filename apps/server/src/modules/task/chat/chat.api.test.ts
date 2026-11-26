import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';

// 대화: 관리자만. 상대는 늘 공간의 대표 (O-2). 메시지 하나 = 대표에게 맡긴 작업 하나 (회차).
// 회차가 끝나지 않았을 때 보낸 말은 덧붙인 말이 되고(2차 1-1), 앞 대화는 다음 회차의 payload.chat.history에 자료로 실린다.
// 회차 아래(위임한 하위 작업 포함)의 결과물 · 기다리는 결재가 그 회차에 실린다.

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
/** run 권한을 준 기기 (러너) */
let runner: string;
let worker: OutboxWorker;

/** 일꾼(outbox)이 할 일을 다 한다: 끝난 작업의 소식 */
async function drain(): Promise<void> {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
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
      ...more,
    }),
    201,
  );
const open = (message: string, requestId = randomUUID()) =>
  api.request('POST', '/api/chats', owner, { requestId, message });
/** 공간의 대표 (O-2, 숨은 에이전트). before에서 첫 대화를 열어 만들어 둔다 */
const lead = async (): Promise<Json> => ok(await api.get('/api/agents/lead', owner)).lead;
const detail = async (id: unknown) => ok(await api.get(`/api/chats/${id}`, owner));
const send = (chat: Json, message: string, requestId = randomUUID(), version = chat.version) =>
  api.request('POST', `/api/chats/${chat.id}/messages`, owner, { requestId, version, message });
const task = async (id: unknown) => ok(await api.get(`/api/tasks/${id}`, owner));

/** 러너가 빌릴 수 있는 일을 모두 빌린다 */
async function jobs(): Promise<Json[]> {
  return (await tool(runner, 'next_jobs', { limit: 5 })).jobs ?? [];
}

/** 러너가 일을 하나 빌린다 */
async function take(): Promise<Json> {
  const { jobs } = await tool(runner, 'next_jobs');
  assert.equal(jobs.length, 1, JSON.stringify(jobs));
  return jobs[0];
}

/** 기기 토큰으로 MCP 도구를 부른다. 실패면 ok: false와 오류 모양 */
async function call(token: string, name: string, args: Json): Promise<{ ok: boolean; body: Json }> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as Json;
  return result.isError
    ? { ok: false, body: JSON.parse(result.content[0]?.text ?? '{}') }
    : { ok: true, body: result.structuredContent ?? {} };
}

/** 이름의 기기를 연결하고, 권한을 더한다 */
async function device(name: string, more: string[] = []): Promise<string> {
  const token = await api.connectDevice(owner, name);
  if (more.length === 0) return token;
  const { devices } = ok(await api.get('/api/devices', owner));
  const d = (devices as Json[]).find((x) => x.name === name) as Json;
  ok(
    await api.request('PATCH', `/api/devices/${d.id}`, owner, {
      scopes: [...d.scopes, ...more],
      version: d.version,
    }),
  );
  return token;
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '대화', siteUrl: api.baseUrl, version });
  runner = await api.connectDevice(owner, 'chat-runner');
  const { devices } = ok(await api.get('/api/devices', owner)) as { devices: Json[] };
  const device = devices.find((d) => d.name === 'chat-runner') as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...device.scopes, 'run'],
      version: device.version,
    }),
  );
  // 대표는 첫 대화에서 생긴다 (같은 DB를 쓰는 앞 파일이 이미 만들었을 수 있다)
  if (!ok(await api.get('/api/agents/lead', owner)).lead)
    ok(await open('대표를 만드는 첫 대화'), 201);
});
after(() => api.close());

/** 이 테스트의 일만 빌려 가게 앞 테스트가 남긴 일을 치운다 */
beforeEach(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});

describe('대화', () => {
  test('방문자 · write 기기는 보지도 보내지도 못한다 (403)', async () => {
    const chat = ok(await open('안녕'), 201);
    const writer = {
      authorization: `Bearer ${await api.writeDevice(owner, `chat-writer-${randomUUID().slice(0, 6)}`)}`,
    };
    for (const headers of [{}, writer]) {
      const calls: [string, string, Json | undefined][] = [
        ['GET', '/api/chats', undefined],
        ['GET', `/api/chats/${chat.id}`, undefined],
        ['POST', '/api/chats', { requestId: randomUUID(), message: '몰래' }],
        [
          'POST',
          `/api/chats/${chat.id}/messages`,
          { requestId: randomUUID(), version: chat.version, message: '몰래' },
        ],
      ];
      for (const [method, path, body] of calls) {
        const res = await api.request(method, path, TestUser.visitor, body, headers);
        assert.equal(res.status, 403, `${method} ${path} ${res.text}`);
      }
    }
  });

  test('메시지 하나 = 대표에게 맡긴 작업 하나. 끝나지 않은 회차에는 덧붙이고, 답이 오면 다음 회차에 이전 대화가 실린다', async () => {
    const partner = await lead();
    const requestId = randomUUID();
    const chat = ok(await open('주말 계획 세워 줘\n둘이서 서울에서', requestId), 201);
    assert.deepEqual([chat.title, chat.turns, chat.agentId], ['주말 계획 세워 줘', 1, partner.id]);
    assert.equal(ok(await open('또', requestId), 201).id, chat.id, '같은 requestId');

    const first = (await detail(chat.id)).turns[0];
    assert.deepEqual(
      [first.turn, first.message, first.status, first.reply],
      [1, '주말 계획 세워 줘\n둘이서 서울에서', 'queued', null],
    );
    const made = await task(first.taskId);
    assert.deepEqual([made.kind, made.agentId], ['general', partner.id]);
    assert.deepEqual(made.payload.chat.history, [], '첫 회차에는 이전 대화가 없다');

    const early = ok(await send(chat, '마감일만 먼저'), 201);
    assert.equal(early.turns, 1, '끝나지 않은 회차에 덧붙인 말 (회차는 그대로)');
    const job = await take();
    assert.equal(job.task.id, first.taskId, '대기열의 회차에는 답하는 작업을 따로 만들지 않는다');
    assert.deepEqual(
      job.chat_updates.appended.map((a: Json) => a.text),
      ['마감일만 먼저'],
      '빌릴 때 덧붙인 말을 함께 받는다',
    );
    await tool(runner, 'submit_result', {
      task_id: job.task.id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '## 계획\n- 성수 카페' },
    });
    const answered = await detail(chat.id);
    assert.deepEqual(
      [answered.turns[0].status, answered.turns[0].reply],
      ['done', '## 계획\n- 성수 카페'],
    );

    const again = randomUUID();
    const second = ok(await send(answered.chat, '저녁은?', again), 201);
    assert.equal(second.turns, 2);
    const resent = ok(await send(answered.chat, '저녁은?', again), 201);
    assert.equal(resent.turns, 2, '같은 requestId는 한 번 (본 version이 낡아도)');
    const turns = (await detail(chat.id)).turns;
    assert.equal(turns.length, 2);
    assert.deepEqual((await task(turns[1].taskId)).payload.chat.history, [
      { from: 'owner', text: '주말 계획 세워 줘\n둘이서 서울에서' },
      { from: 'agent', text: '## 계획\n- 성수 카페' },
    ]);
    assert.equal((await send(answered.chat, '늦은 version')).status, 409);

    const { chats } = ok(await api.get('/api/chats', owner));
    const listed = chats.find((c: Json) => c.id === chat.id);
    assert.deepEqual([listed.agentName, listed.turns, listed.state], [partner.name, 2, 'working']);
  });

  test('상대는 늘 대표 (O-2): 예전 화면이 보내는 agentId는 읽지 않는다. 대표를 멈추면 열지도 보내지도 못한다 (422)', async () => {
    const member = await agent('일꾼');
    const boss = await lead();
    const chat = ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        agentId: member.id,
        message: '안녕',
      }),
      201,
    );
    assert.equal(chat.agentId, boss.id);
    const turn = (await detail(chat.id)).turns[0];
    assert.equal((await task(turn.taskId)).agentId, boss.id);
    ok(await api.request('POST', `/api/agents/${boss.id}/pause`, owner, { version: boss.version }));
    const paused = await open('쉬는 동안');
    assert.equal(paused.status, 422, paused.text);
    assert.match(paused.text, /대표를 멈췄어요/);
    const resting = await lead();
    ok(
      await api.request('POST', `/api/agents/${boss.id}/resume`, owner, {
        version: resting.version,
      }),
    );
    ok(await open('다시 일해요'), 201);
  });

  test('O-2 전에 맡기 전이던 대화는 다음 말에서 대표가 맡는다: 맡기 전 메시지가 첫 회차, 이번 말은 덧붙인 말', async () => {
    const boss = await lead();
    const [space] = await db.sql`SELECT space_id FROM task.agents WHERE id = ${boss.id}`;
    const [old] = await db.sql`
      INSERT INTO task.chats (space_id, agent_id, pending, title, turns, request_id)
      VALUES (${space?.space_id}, NULL, '옛 배정을 기다리던 말', '옛 배정을 기다리던 말', 0, ${randomUUID()})
      RETURNING id, version`;
    const before = await detail(old?.id);
    assert.deepEqual([before.chat.agentId, before.state], [null, 'asking']);
    assert.equal('question' in before, false, '맡을 에이전트를 묻는 질문 칸은 없다 (O-3에서 지움)');
    const sent = ok(await send(before.chat, '이것도 같이 봐 줘'), 201);
    assert.deepEqual([sent.agentId, sent.turns, sent.pending], [boss.id, 1, null]);
    const job = await take();
    assert.equal(job.instruction, '옛 배정을 기다리던 말');
    assert.deepEqual(
      job.chat_updates.appended.map((a: Json) => a.text),
      ['이것도 같이 봐 줘'],
    );
  });

  test('회차 아래에서 만든 결과물은 그 회차에, 올린 결재는 결과 카드에 실린다 (2차 2단계)', async () => {
    const writer = await agent('발행', { approvalActions: ['blog.post.publish'] });
    const chat = ok(await open('글 올려 줘'), 201);
    const turnJob = await take();
    await tool(turnJob.run_token, 'delegate_task', {
      subtasks: [
        { request_id: randomUUID(), to_agent_id: writer.id, title: '발행', instruction: '올려' },
      ],
    });
    const job = await take();
    assert.equal(job.task.title, '발행', '대표가 맨 위 팀장에게 맡긴 일');
    await tool(job.run_token, 'request_approval', {
      request_id: randomUUID(),
      action: 'blog.post.publish',
      target_kind: 'post',
      target_id: randomUUID(),
      target_version: 1,
      note: '공개해 주세요',
    });
    const [run] =
      await db.sql`SELECT id, space_id FROM task.task_runs WHERE task_id = ${job.task.id}`;
    await db.sql`
      INSERT INTO task.outputs (space_id, task_id, run_id, name, kind, mime, size_bytes, blob_hash)
      VALUES (${run?.space_id}, ${job.task.id}, ${run?.id}, 'deck.html', 'document', 'text/html', 10, ${'a'.repeat(64)})`;
    const turn = (await detail(chat.id)).turns[0];
    assert.equal(turn.status, 'waiting', '하위 작업을 기다리는 회차');
    assert.equal(turn.approvalIds.length, 0, '대화의 결재는 회차가 아니라 결과 카드에서 정한다');
    assert.deepEqual(
      turn.outputs.map((o: Json) => o.name),
      ['deck.html'],
    );
    await drain();
    assert.deepEqual(
      (await detail(chat.id)).card.items.map((i: Json) => i.kind),
      ['action', 'output'],
    );
  });

  test('대화의 토큰 (O-1): 회차 · 하위 작업의 실행 기록이 대화 · 회차 · 에이전트별로 모이고, 다른 대화와 섞이지 않는다', async () => {
    const boss = await lead();
    const member = await agent('토큰 팀장');
    const chat = ok(await open('토큰을 세어 봐'), 201);
    const other = ok(await open('다른 대화'), 201);
    const turnOf = async (id: unknown) =>
      (await jobs()).find((j) => j.task.payload?.chat?.chatId === id) as Json;
    const spend = (taskId: unknown, tokens: number) =>
      tool(runner, 'report_progress', {
        task_id: taskId,
        request_id: randomUUID(),
        events: [{ kind: 'read', body: '읽음', tokens }],
      });
    const done = (taskId: unknown) =>
      tool(runner, 'submit_result', {
        task_id: taskId,
        request_id: randomUUID(),
        status: 'done',
        result: { text: '끝' },
      });

    const leased = await jobs();
    const turnIn = (id: unknown) => leased.find((j) => j.task.payload?.chat?.chatId === id) as Json;
    const [first, elsewhere] = [turnIn(chat.id), turnIn(other.id)];
    await spend(first.task.id, 1200);
    await spend(elsewhere.task.id, 500);
    await tool(first.run_token, 'delegate_task', {
      subtasks: [
        {
          request_id: randomUUID(),
          to_agent_id: member.id,
          title: '토큰 하위',
          instruction: '세어',
        },
      ],
    });
    const sub = (await jobs()).find((j) => j.task.title === '토큰 하위') as Json;
    await spend(sub.task.id, 800);
    await done(sub.task.id);
    await drain();
    const back = (await jobs()).find((j) => j.task.id === first.task.id) as Json;
    await done(back.task.id);
    await drain();

    const now = await detail(chat.id);
    ok(await send(now.chat, '한 번 더'), 201);
    const second = await turnOf(chat.id);
    await spend(second.task.id, 300);

    const { usage } = await detail(chat.id);
    assert.equal(usage.tokens, 2300);
    assert.deepEqual(
      usage.agents.map((a: Json) => [a.agentId, a.tokens]),
      [
        [boss.id, 1500],
        [member.id, 800],
      ],
      '에이전트별 (많은 순)',
    );
    assert.deepEqual(
      usage.turns.map((t: Json) => [t.turn, t.tokens, t.agents.length]),
      [
        [1, 2000, 2],
        [2, 300, 1],
      ],
      '회차마다 (하위 작업은 그 회차에)',
    );
    const { chats } = ok(await api.get('/api/chats', owner));
    const tokensOf = (id: unknown) => chats.find((c: Json) => c.id === id)?.tokens;
    assert.deepEqual(
      [tokensOf(chat.id), tokensOf(other.id)],
      [2300, 500],
      '목록의 합계는 상세와 같다',
    );
  });

  test('목표 · 프로젝트(git 주소를 맞춘다)와 함께 열면 대표가 바로 맡는다. 주소가 아니면 422', async () => {
    const boss = await lead();
    const chat = ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        message: '이번 주 글감 정리해 줘',
        goal: '금요일까지 초안 셋',
        project: 'https://github.com/Me/Blog.git',
      }),
      201,
    );
    assert.deepEqual(
      [chat.agentId, chat.goal, chat.project],
      [boss.id, '금요일까지 초안 셋', 'github.com/me/blog'],
    );
    const bad = await api.request('POST', '/api/chats', owner, {
      requestId: randomUUID(),
      message: '정리',
      project: '그냥 글자',
    });
    assert.equal(bad.status, 422, bad.text);
  });
});

describe('대화의 앱 (스토어 2단계)', () => {
  const newApp = async () =>
    ok(
      await api.request('POST', '/api/apps', owner, {
        requestId: randomUUID(),
        kind: 'blog',
        name: '대화 앱',
        slug: `chat-${randomUUID().slice(0, 6)}`,
      }),
      201,
    );
  const openIn = (appId: unknown, message: string) =>
    api.request('POST', '/api/chats', owner, { requestId: randomUUID(), message, appId });

  test('앱 관리에서 연 대화는 앱을 들고, 대표의 회차가 payload.chat.appId로 싣는다. ?app=으로 거른다', async () => {
    const app = await newApp();
    const made = ok(await openIn(app.id, '이 앱에 글 하나'), 201);
    assert.equal(made.appId, app.id);
    const { chat, turns } = await detail(made.id);
    assert.equal(chat.appId, app.id);
    assert.equal((await task(turns[0].taskId)).payload.chat.appId, app.id);

    const plain = ok(await open('앱 없는 대화'), 201);
    assert.equal(plain.appId, null);
    const plainTurn = (await detail(plain.id)).turns[0];
    assert.equal('appId' in (await task(plainTurn.taskId)).payload.chat, false);

    const listed = ok(await api.get(`/api/chats?app=${app.id}`, owner)).chats as Json[];
    assert.deepEqual(
      listed.map((c) => [c.id, c.appId]),
      [[made.id, app.id]],
    );
    const all = ok(await api.get('/api/chats', owner)).chats as Json[];
    assert.ok(all.some((c) => c.id === plain.id));
    assert.equal((await api.get('/api/chats?app=nope', owner)).status, 400);
  });

  test('다음 회차도 앱을 싣고, 덧붙인 말의 답에도 싣는다 (새 일이면 답에서 그 앱의 팀에 맡긴다, 2026-11-20)', async () => {
    const app = await newApp();
    const made = ok(await openIn(app.id, '첫 글'), 201);
    const first = await take();
    ok(await send(made, '제목은 짧게'), 201);
    const reply = (await jobs()).find(
      (j) => j.task.payload?.chat?.chatId === made.id && j.task.payload.chat.reply,
    ) as Json;
    assert.ok(reply, '도는 회차에 덧붙인 말은 답하는 작업이 된다');
    assert.equal(reply.task.payload.chat.appId, app.id);
    await tool(runner, 'submit_result', {
      task_id: first.task.id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '초안을 썼어요' },
    });
    const now = (await detail(made.id)).chat;
    ok(await send(now, '하나 더'), 201);
    const second = (await detail(made.id)).turns.at(-1);
    assert.equal((await task(second.taskId)).payload.chat.appId, app.id);
  });

  test('도는 회차 옆에서 덧붙인 말의 답이 새 일을 팀원에게 바로 맡기고, 두 일이 함께 돈다 (병렬, 2026-11-20)', async () => {
    const member = await agent('병렬 팀원');
    const made = ok(await open('시장 조사 보고서'), 201);
    const first = await take();
    ok(await send(made, '그리고 이번 주 일정표도 따로 만들어 줘'), 201);
    const reply = (await jobs()).find(
      (j) => j.task.payload?.chat?.chatId === made.id && j.task.payload.chat.reply,
    ) as Json;
    assert.ok(reply, '도는 회차에 덧붙인 말은 답하는 작업이 된다');
    await tool(reply.run_token, 'delegate_task', {
      subtasks: [
        {
          request_id: randomUUID(),
          to_agent_id: member.id,
          title: '일정표 만들기',
          instruction: '이번 주 일정표',
        },
      ],
    });
    const side = (await jobs()).find((j) => j.task.title === '일정표 만들기') as Json;
    assert.ok(side, '새 일은 회차를 기다리지 않고 바로 빌려 간다');
    assert.equal((await task(first.task.id)).status, 'running', '회차는 하던 일을 계속한다');
    const { team } = await detail(made.id);
    assert.ok(
      (team as Json[]).some((t) => t.taskId === side.task.id),
      '대화의 팀 칸에 함께 보인다',
    );
  });

  test('없는 앱 · 모양이 틀린 앱은 대화를 열지 않는다 (404 · 400)', async () => {
    assert.equal((await openIn(randomUUID(), '없는 앱')).status, 404);
    assert.equal((await openIn('nope', '모양')).status, 400);
  });
});

describe('대화 입력창 (2026-11-15 B): 참조 · 모델', () => {
  test('주소 참조는 회차 작업의 payload.refs와 회차에 실린다. 모양이 틀리면 400, 없는 참조는 422', async () => {
    const refs = [{ kind: 'url', url: 'https://example.com/a', browser: false }];
    const chat = ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        message: '이 글 요약해 줘',
        refs,
      }),
      201,
    );
    const turn = (await detail(chat.id)).turns[0];
    assert.deepEqual(
      turn.refs.map((r: Json) => [r.kind, r.url, r.private]),
      [['url', 'https://example.com/a', false]],
    );
    assert.deepEqual((await task(turn.taskId)).payload.refs.length, 1);
    const shape = await api.request('POST', '/api/chats', owner, {
      requestId: randomUUID(),
      message: '틀린 참조',
      refs: [
        { kind: 'url', url: 'ftp://example.com' },
        { kind: 'nope', id: randomUUID() },
      ],
    });
    assert.equal(shape.status, 400, shape.text);
    const missing = await api.request('POST', '/api/chats', owner, {
      requestId: randomUUID(),
      message: '없는 위키',
      refs: [{ kind: 'wiki', id: randomUUID() }],
    });
    assert.equal(missing.status, 422, missing.text);
  });

  test('사진인 결과물은 참조에 image가 붙어 회차에 실리고, 한 번에 5장이면 422 (대화에 사진 넣기)', async () => {
    const upload = async (name: string, body: Buffer) => {
      const res = await fetch(`${api.baseUrl}/api/outputs/files?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', cookie: owner.header },
        body,
      });
      assert.equal(res.status, 201, await res.clone().text());
      return (await res.json()) as Json;
    };
    const png = () =>
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        randomBytes(32),
      ]);
    const photo = await upload('사진.png', png());
    const sheet = await upload('메모.csv', Buffer.from('가,나\n'));
    // 이름으로 정한 그림(SVG)은 종류가 image여도 사진이 아니다 (AI CLI가 보지 못한다)
    const drawing = await upload(
      '도형.svg',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    );
    const chat = ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        message: '이 사진 봐 줘',
        refs: [
          { kind: 'output', id: photo.id },
          { kind: 'output', id: sheet.id },
          { kind: 'output', id: drawing.id },
        ],
      }),
      201,
    );
    const turn = (await detail(chat.id)).turns[0];
    assert.deepEqual(
      turn.refs.map((r: Json) => [r.title, r.image]),
      [
        ['사진.png', true],
        ['메모.csv', false],
        ['도형.svg', false],
      ],
    );
    assert.equal((await task(turn.taskId)).payload.refs[0].image, true);

    const five = [];
    for (let n = 1; n <= 5; n++) five.push(await upload(`사진${n}.png`, png()));
    const many = await api.request('POST', '/api/chats', owner, {
      requestId: randomUUID(),
      message: '사진 다섯 장',
      refs: five.map((p) => ({ kind: 'output', id: p.id })),
    });
    assert.equal(many.status, 422, many.text);
    assert.match(many.text, /사진은 한 번에 4장까지예요/);
  });

  test('일하는 중에 보낸 참조는 422 (덧붙인 말은 회차가 아니다)', async () => {
    const chat = ok(await open('첫 일'), 201);
    const res = await api.request('POST', `/api/chats/${chat.id}/messages`, owner, {
      requestId: randomUUID(),
      version: chat.version,
      message: '이것도 봐 줘',
      refs: [{ kind: 'url', url: 'https://example.com/b' }],
    });
    assert.equal(res.status, 422, res.text);
  });

  test('대화의 모델 · 생각 강도: 그 회차의 일에 실리고 도구가 받지 않는 강도는 422, 낡은 version은 409', async () => {
    // 대표의 AI 도구는 관리자가 바꾼다 (설정 › AI). 끝에 되돌린다: 다른 테스트의 러너는 claude로 빌린다
    const boss = await lead();
    const codex = ok(
      await api.request('PATCH', `/api/agents/${boss.id}`, owner, {
        version: boss.version,
        tool: 'codex',
      }),
    );
    const chat = ok(await open('첫 일'), 201);
    const bad = await api.request('PATCH', `/api/chats/${chat.id}`, owner, {
      version: chat.version,
      model: 'gpt-5',
      effort: 'max',
    });
    assert.equal(bad.status, 422, bad.text);
    const tuned = ok(
      await api.request('PATCH', `/api/chats/${chat.id}`, owner, {
        version: chat.version,
        model: 'gpt-5',
        effort: 'high',
      }),
    );
    assert.deepEqual([tuned.model, tuned.effort], ['gpt-5', 'high']);
    const stale = await api.request('PATCH', `/api/chats/${chat.id}`, owner, {
      version: chat.version,
      model: null,
      effort: null,
    });
    assert.equal(stale.status, 409, stale.text);
    const visitor = await api.request('PATCH', `/api/chats/${chat.id}`, TestUser.visitor, {
      version: tuned.version,
      model: null,
    });
    assert.equal(visitor.status, 403);
    ok(
      await api.request('PATCH', `/api/agents/${boss.id}`, owner, {
        version: codex.version,
        tool: 'claude',
      }),
    );
  });
});

describe('내 컴퓨터의 AI 도구가 서버 팀에 맡기기 (MCP ask_agent · agent_updates, 기기 권한 delegate)', () => {
  test('권한이 없는 기기에는 도구가 보이지 않고, 부르면 delegate 권한을 알린다', async () => {
    const plain = await device(`plain-${randomUUID().slice(0, 6)}`);
    const list = await api.mcp(plain, 'tools/list');
    const names = (list.json().result as Json).tools.map((t: Json) => t.name);
    assert.equal(names.includes('ask_agent') || names.includes('agent_updates'), false);
    const refused = await call(plain, 'ask_agent', { request_id: randomUUID(), message: '검토' });
    assert.deepEqual([refused.ok, refused.body.scope], [false, 'delegate']);
  });

  test('받는 쪽은 늘 대표 (예전 스킬의 agent는 읽지 않는다). 기다리지 않고 소식으로 받는다: 덧붙인 말 · 대표의 짧은 답 · 최종 답, 커서 · 상태판', async () => {
    const boss = await lead();
    await agent('다른 팀장');
    const mac = await device(`mac-${randomUUID().slice(0, 6)}`, ['delegate']);
    const names = await api.mcp(mac, 'tools/list');
    const tools = (names.json().result as Json).tools.map((t: Json) => t.name);
    assert.ok(tools.includes('ask_agent') && tools.includes('agent_updates'));
    assert.equal(tools.includes('agent_reply'), false, 'agent_reply는 없다 (세션을 묶지 않는다)');
    // 설명 · 칸 설명은 코드가 아니라 설명서(task.tools.ko.json)에서 얹힌다. 형식 · 길이는 코드의 것
    const ask = (names.json().result as Json).tools.find((t: Json) => t.name === 'ask_agent');
    assert.match(ask.description, /에이전트 팀/);
    assert.equal(ask.inputSchema.properties.message.description, '보낼 메시지');
    assert.equal(ask.inputSchema.properties.message.maxLength, 8000);

    const requestId = randomUUID();
    const sent = await call(mac, 'ask_agent', {
      request_id: requestId,
      agent: '다른 팀장',
      message: '이 분석 검토해 줘\n결론: A안',
      goal: '대회 제출 전에 근거를 보강한다',
      project: 'git@github.com:Owner/Contest.git',
    });
    assert.equal(sent.ok, true, JSON.stringify(sent.body));
    const chatId = sent.body.id;
    assert.deepEqual(
      [sent.body.agentId, sent.body.goal, sent.body.project],
      [boss.id, '대회 제출 전에 근거를 보강한다', 'github.com/owner/contest'],
      '이름을 보내도 대표가 받는다, 프로젝트는 host/owner/repo로',
    );
    const again = await call(mac, 'ask_agent', { request_id: requestId, message: '같은 말' });
    assert.equal(again.body.id, chatId, '같은 request_id는 같은 대화');
    const bad = await call(mac, 'ask_agent', {
      request_id: randomUUID(),
      message: '검토',
      project: '그냥 이름',
    });
    assert.deepEqual([bad.ok, bad.body.code], [false, 'rule_violation']);

    const start = await call(mac, 'agent_updates', { chat_id: chatId });
    assert.deepEqual(start.body.news, [], '맡음 소식은 없다 (늘 대표)');
    const board = start.body.board[0];
    assert.deepEqual(
      [board.chat_id, board.state, board.active, board.project],
      [chatId, 'working', 1, 'github.com/owner/contest'],
    );
    const job = (await jobs()).find((j) => j.task.payload.chat?.chatId === chatId) as Json;
    assert.equal(job.task.payload.chat.via, 'device');

    // 도는 회차에 덧붙이면 소식 한 줄 + 대표가 짧게 답하는 작업 (회차는 그대로)
    const more = await call(mac, 'ask_agent', {
      request_id: randomUUID(),
      message: '마감일만 먼저 알려 줘',
      chat_id: chatId,
    });
    assert.deepEqual([more.ok, more.body.turns], [true, 1]);
    const reply = (await jobs()).find((j) => j.task.payload.chat?.reply) as Json;
    assert.equal(reply.task.payload.chat.chatId, chatId);
    assert.equal(reply.instruction, '마감일만 먼저 알려 줘');
    await tool(runner, 'submit_result', {
      task_id: reply.task.id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '마감은 11월 30일이에요' },
    });
    await tool(runner, 'submit_result', {
      task_id: job.task.id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '## 검토\n- 고칠 것: 근거 2' },
    });
    await drain();
    const news = await call(mac, 'agent_updates', { after: start.body.cursor });
    // 끝남 소식은 일꾼이 이벤트를 다루는 순서대로 쌓인다 (짧은 답과 최종 답의 순서는 정해져 있지 않다)
    const kinds = news.body.news.map((n: Json) => [n.kind, n.text.split('\n')[0]]);
    assert.deepEqual(kinds[0], ['appended', '마감일만 먼저 알려 줘']);
    assert.deepEqual(kinds.slice(1).sort(), [
      ['final', '## 검토'],
      ['reply', '마감은 11월 30일이에요'],
    ]);
    const final = news.body.news.find((n: Json) => n.kind === 'final');
    assert.match(final.text, new RegExp(`/admin/chats/${chatId}$`));
    assert.equal(news.body.board.find((b: Json) => b.chat_id === chatId).state, 'done');
    const empty = await call(mac, 'agent_updates', { after: news.body.cursor });
    assert.deepEqual([empty.body.news, empty.body.cursor], [[], news.body.cursor]);
    const ahead = await call(mac, 'agent_updates', { after: news.body.cursor + 1000 });
    assert.deepEqual([ahead.ok, ahead.body.code], [false, 'rule_violation']);

    const { chats } = ok(await api.get('/api/chats', owner));
    assert.ok((chats as Json[]).some((c) => c.id === chatId && c.deviceId === sent.body.deviceId));
    const next = await call(mac, 'ask_agent', {
      request_id: randomUUID(),
      message: '고쳤어. 다시 봐 줘',
      chat_id: chatId,
    });
    assert.equal(next.body.turns, 2, '끝난 회차 뒤에는 다음 회차');
  });

  test('대화의 일을 하는 에이전트는 post_update로 소식을 남긴다 (대화 밖의 일은 422). 팀원이 끝나면 소식, 회차는 다음 실행에 팀 소식을 받는다', async () => {
    const boss = await lead();
    const member = await agent('리서처');
    const mac = await device(`team-${randomUUID().slice(0, 6)}`, ['delegate']);
    const sent = await call(mac, 'ask_agent', {
      request_id: randomUUID(),
      message: '대회 요강 정리해 줘',
    });
    const chatId = sent.body.id;
    const turn = (await jobs()).find((j) => j.task.payload.chat?.chatId === chatId) as Json;
    const start = (await call(mac, 'agent_updates', { chat_id: chatId })).body.cursor;
    const posted = await tool(turn.run_token, 'post_update', {
      kind: 'decision',
      text: '본선 규정을 먼저 본다',
    });
    assert.ok(posted.n > start);
    const wrong = await call(turn.run_token, 'post_update', { kind: 'final', text: '끝' });
    assert.deepEqual([wrong.ok, wrong.body.code], [false, 'rule_violation']);

    await tool(turn.run_token, 'delegate_task', {
      subtasks: [
        {
          request_id: randomUUID(),
          to_agent_id: member.id,
          title: '요강 읽기',
          instruction: '요강을 읽어',
        },
      ],
    });
    const sub = (await jobs()).find((j) => j.task.title === '요강 읽기') as Json;
    await tool(sub.run_token, 'post_update', {
      kind: 'assumption',
      text: '본선은 오프라인이라고 가정',
    });
    // 대화 상세(관리자)의 "팀이 동시에 일하는 중" 칸 (2026-11-15 B): 이 대화의 일과 그 아래 작업, 상태와 도는 작업 수
    const busy = await detail(chatId);
    assert.deepEqual([busy.state, busy.active], ['working', 2]);
    // 지금 단계 (2026-11-26): 일꾼을 기다리는 대표는 실행, 빌렸지만 기록이 없는 일꾼은 준비 → 기록이 쌓이면 실행 → 결과를 내면 검사
    assert.deepEqual(
      (busy.team as Json[]).map((t) => [t.title, t.status, t.stage]),
      [
        ['대화 · 대회 요강 정리해 줘', 'waiting', 'run'],
        ['요강 읽기', 'running', 'prepare'],
      ],
    );
    const stageOf = async () =>
      ((await detail(chatId)).team as Json[]).find((t) => t.title === '요강 읽기')?.stage;
    await tool(runner, 'report_progress', {
      task_id: sub.task.id,
      events: [{ kind: 'read', body: '요강 읽는 중', tokens: 10 }],
    });
    assert.equal(await stageOf(), 'run');
    await tool(runner, 'report_progress', {
      task_id: sub.task.id,
      events: [{ kind: 'result', body: '평가 기준 3가지', tokens: 10 }],
    });
    assert.equal(await stageOf(), 'check');
    await tool(runner, 'submit_result', {
      task_id: sub.task.id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '평가 기준 3가지' },
    });
    await drain();
    const news = (await call(mac, 'agent_updates', { chat_id: chatId, after: start })).body.news;
    assert.deepEqual(
      news.map((n: Json) => [n.kind, n.agent, n.text]),
      [
        ['decision', boss.name, '본선 규정을 먼저 본다'],
        ['assumption', member.name, '본선은 오프라인이라고 가정'],
        ['member_done', member.name, '요강 읽기 — 평가 기준 3가지'],
      ],
    );
    const room = await detail(chatId);
    assert.deepEqual([room.state, room.active], ['working', 1], '팀원은 끝났고 회차가 다시 돈다');
    assert.deepEqual(
      room.news.slice(-3).map((n: Json) => [n.kind, n.agent]),
      news.map((n: Json) => [n.kind, n.agent]),
      '상세의 소식은 agent_updates와 같다',
    );
    const woken = (await jobs()).find((j) => j.task.id === turn.task.id) as Json;
    assert.deepEqual(
      woken.chat_updates.team.map((t: Json) => [t.kind, t.text]),
      [['assumption', '본선은 오프라인이라고 가정']],
      '깨어난 회차는 팀원이 남긴 소식을 자료로 받는다',
    );

    const outside = ok(
      await api.request('POST', '/api/tasks', owner, {
        requestId: randomUUID(),
        agentId: member.id,
        kind: 'general',
        instruction: '대화 밖의 일',
      }),
      201,
    );
    const loose = (await jobs()).find((j) => j.task.id === outside.id) as Json;
    const refused = await call(loose.run_token, 'post_update', { kind: 'progress', text: '중간' });
    assert.deepEqual([refused.ok, refused.body.code], [false, 'rule_violation']);
  });

  test('소식 기기(news, cairn connect의 훅 · 상태 줄)는 모든 대화의 소식을 읽기만 한다', async () => {
    const mac = await device(`n-mac-${randomUUID().slice(0, 6)}`, ['delegate']);
    const hook = await api.connectDevice(owner, `n-hook-${randomUUID().slice(0, 6)}`, 'news');
    const list = await api.mcp(hook, 'tools/list');
    const names = (list.json().result as Json).tools.map((t: Json) => t.name);
    assert.deepEqual(names, ['agent_updates'], '소식 기기에는 agent_updates 하나만');
    const refused = await call(hook, 'ask_agent', { request_id: randomUUID(), message: '몰래' });
    assert.deepEqual([refused.ok, refused.body.scope], [false, 'delegate']);

    const start = (await call(hook, 'agent_updates', {})).body.cursor;
    const fromMac = await call(mac, 'ask_agent', {
      request_id: randomUUID(),
      message: '기기에서 맡김',
      project: 'git@github.com:Me/Repo.git',
    });
    const fromOwner = ok(await open('관리자가 맡김'), 201);
    const seen = (await call(hook, 'agent_updates', { after: start })).body;
    const boards = seen.board.map((b: Json) => b.chat_id);
    assert.ok(
      boards.includes(fromMac.body.id) && boards.includes(fromOwner.id),
      '모든 대화가 보인다',
    );
    const only = (await call(hook, 'agent_updates', { project: 'github.com/me/repo' })).body;
    assert.deepEqual(
      only.board.map((b: Json) => b.chat_id),
      [fromMac.body.id],
      '프로젝트로 거른다',
    );
  });

  test('다른 기기 · 관리자의 대화는 없는 것처럼 (404)', async () => {
    const mine = await device(`a-${randomUUID().slice(0, 6)}`, ['delegate']);
    const other = await device(`b-${randomUUID().slice(0, 6)}`, ['delegate']);
    const sent = await call(mine, 'ask_agent', {
      request_id: randomUUID(),
      message: 'https://example.com/brief 읽고 검토해 줘',
    });
    const chatId = sent.body.id;
    const res = await call(other, 'ask_agent', {
      request_id: randomUUID(),
      message: '끼어들기',
      chat_id: chatId,
    });
    assert.deepEqual([res.ok, res.body.code], [false, 'not_found']);
    const seen = await call(other, 'agent_updates', { chat_id: chatId });
    assert.deepEqual(seen.body.board, [], '남의 대화는 상태판에도 없다');
    const ownerChat = ok(await open('관리자의 대화'), 201);
    const into = await call(mine, 'ask_agent', {
      request_id: randomUUID(),
      message: '이어서',
      chat_id: ownerChat.id,
    });
    assert.deepEqual([into.ok, into.body.code], [false, 'not_found']);
  });
});

describe('대표 (O-2): 나눠 맡기기 · 브라우저 규칙', () => {
  const delegate = (job: Json, agentId: unknown, title: string, kind = 'general') =>
    call(job.run_token, 'delegate_task', {
      subtasks: [
        { request_id: randomUUID(), to_agent_id: agentId, kind, title, instruction: title },
      ],
    });
  const turnOf = async (chatId: unknown) =>
    (await jobs()).find((j) => j.task.payload?.chat?.chatId === chatId) as Json;

  test('대표는 지우지 않은 일꾼 누구에게나 맡긴다. 일꾼 목록에는 일꾼마다 한 줄, 팀 요약은 없다. 일꾼은 맡기지 못한다 (2026-11-21)', async () => {
    const first = await agent('조사원');
    const second = await agent('정리원');
    const gone = await agent('지운 일꾼');
    ok(
      await api.request('POST', `/api/agents/${gone.id}/delete`, owner, { version: gone.version }),
    );
    const chat = ok(await open('시장 조사해 줘'), 201);
    const job = await turnOf(chat.id);
    assert.equal(job.agent.lead, true, '러너가 지시문 틀의 lead 단락을 넣는다');
    const team = job.team as Json[];
    for (const a of [first, second]) {
      const listed = team.find((m) => m.agent_id === a.id) as Json;
      assert.equal(listed?.name, a.name);
      assert.equal(listed.team, undefined, '팀 요약 칸은 없다');
    }
    assert.ok(!team.some((m) => m.agent_id === gone.id), '지운 일꾼은 없다');
    assert.ok(!team.some((m) => m.agent_id === job.agent.id), '대표 자신은 없다');
    const toGone = await delegate(job, gone.id, '지운 일꾼에게');
    assert.deepEqual([toGone.ok, toGone.body.code], [false, 'forbidden']);

    const sent = await delegate(job, second.id, '정리원에게');
    assert.equal(sent.ok, true, JSON.stringify(sent.body));
    const sub = (await jobs()).find((j) => j.task.title === '정리원에게') as Json;
    assert.deepEqual(sub.team, [], '일꾼의 일에는 일꾼 목록이 없다');
    const nested = await delegate(sub, first.id, '일꾼이 맡기기');
    assert.deepEqual([nested.ok, nested.body.code], [false, 'forbidden'], '일꾼은 맡기지 못한다');
  });

  test('브라우저 일은 browser-tabs가 동작해야 맡긴다. 비공개를 읽은 대화 · 비공개 참조가 있어도 맡긴다 (2026-11-21)', async (t) => {
    const browser = await agent('브라우저 담당');
    const reader = await agent('비공개 담당');
    const clean = ok(await open('사이트 둘러봐 줘'), 201);
    const cleanTurn = await turnOf(clean.id);
    // 브라우저 일은 browser-tabs가 동작해야 맡긴다 (러너가 browser_job이 없어 실패하기 전에, 2026-11-21)
    const off = await delegate(cleanTurn, browser.id, '둘러보기', 'browse');
    assert.deepEqual([off.ok, off.body.code], [false, 'rule_violation']);
    assert.match(off.body.message, /browser-tabs 플러그인이 동작해야 해요/);
    ok(await api.request('POST', '/api/plugins/browser-tabs/enable', owner));
    t.after(() => api.request('POST', '/api/plugins/browser-tabs/disable', owner));
    const fine = await delegate(cleanTurn, browser.id, '둘러보기', 'browse');
    assert.equal(fine.ok, true, JSON.stringify(fine.body));

    // 비공개를 읽는 일꾼이 일한 회차 뒤에도 브라우저 일을 맡긴다 (바깥을 바꾸는 클릭은 원칙 7대로 승인 뒤)
    const chat = ok(await open('내 메모를 보고 사이트에 올려 줘'), 201);
    const turn = await turnOf(chat.id);
    assert.equal((await delegate(turn, reader.id, '메모 읽기')).ok, true);
    const sub = (await jobs()).find((j) => j.task.title === '메모 읽기') as Json;
    await tool(runner, 'submit_result', {
      task_id: sub.task.id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '메모 요약' },
    });
    await drain();
    const woken = (await jobs()).find((j) => j.task.id === turn.task.id) as Json;
    const upload = await delegate(woken, browser.id, '올리기', 'browse');
    assert.equal(upload.ok, true, JSON.stringify(upload.body));

    const referred = ok(await open('이 위키로 사이트 채워 줘'), 201);
    const withRef = await turnOf(referred.id);
    await db.sql`
      UPDATE task.tasks
      SET payload = payload || ${db.sql.json({ refs: [{ kind: 'wiki', id: randomUUID(), title: '메모', private: true, url: null, browser: false }] })}::jsonb
      WHERE id = ${withRef.task.id}`;
    const byRef = await delegate(withRef, browser.id, '채우기', 'browse');
    assert.equal(byRef.ok, true, JSON.stringify(byRef.body));
  });
});
