import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, type TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';

// 목표 확인 질문 (2026-11-20, MCP ask_brief): 대표가 결과물 일을 맡기 전에 핵심을 묻고 회차를 끝낸다.
// 관리자의 답은 다음 회차의 메시지가 되고, 그 회차에서는 다시 묻지 않고 계획 · 위임으로 간다

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 테스트 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let worker: OutboxWorker;
let runner: string;
let member: Json;

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

/** 도구가 거절한 글 (isError) */
async function refused(token: string, name: string, args: Json = {}): Promise<string> {
  const res = await call(token, name, args);
  const result = (res.json() as Json).result;
  assert.equal(result.isError, true, JSON.stringify(result));
  return JSON.stringify(result.content);
}

async function turnOf(chatId: string, turn: number): Promise<Json> {
  const jobs: Json[] = (await tool(runner, 'next_jobs', { limit: 5 })).jobs ?? [];
  const job = jobs.find(
    (j) => j.task.payload.chat?.chatId === chatId && j.task.payload.chat?.turn === turn,
  );
  assert.ok(job, `${turn}번째 회차가 빌려지지 않았다`);
  return job;
}

const detail = async (chatId: string) => ok(await api.get(`/api/chats/${chatId}`, owner));

const BRIEF = {
  summary: '신제품 소개 페이지 한 장',
  questions: [
    {
      text: '누가 보나요?',
      why: '말투와 깊이가 달라져요',
      choices: ['고객', '투자자', '사내'],
      suggested: '고객',
    },
    { text: '꼭 넣을 숫자가 있나요?', why: '근거 칸의 내용', suggested: '출시일과 가격' },
  ],
};

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '질문', siteUrl: api.baseUrl, version });
  runner = await api.connectDevice(owner, 'brief-runner');
  const { devices } = ok(await api.get('/api/devices', owner)) as { devices: Json[] };
  const device = devices.find((d) => d.name === 'brief-runner') as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...device.scopes, 'run'],
      version: device.version,
    }),
  );
  member = ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `제작 ${randomUUID().slice(0, 6)}`,
      tool: 'claude',
      scopes: ['read_public'],
    }),
    201,
  );
});

after(async () => {
  await db.sql`UPDATE task.agents SET deleted_at = now() WHERE id = ${member.id}`;
  await api.close();
});

beforeEach(async () => {
  await drain();
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});

describe('목표 확인 질문', () => {
  test('물은 회차는 맡기지 못하고 받을 것도 검사하지 않는다. 질문은 회차에 실리고 소식으로 보인다', async () => {
    const chat = ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        message: '신제품 소개 페이지 만들어 줘',
      }),
      201,
    );
    const turn = await turnOf(chat.id, 1);
    await tool(turn.run_token, 'set_deliver', { deliver: 'file' });
    assert.deepEqual(await tool(turn.run_token, 'ask_brief', BRIEF), {
      asked: 2,
      next: 'finish_turn',
    });
    assert.match(await refused(turn.run_token, 'ask_brief', BRIEF), /이미 물었어요/);
    assert.match(
      await refused(turn.run_token, 'delegate_task', {
        subtasks: [
          {
            request_id: randomUUID(),
            to_agent_id: member.id,
            title: '페이지',
            instruction: '만들기',
          },
        ],
      }),
      /목표 확인 질문을 했어요/,
    );
    await tool(runner, 'submit_result', {
      task_id: turn.task.id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '몇 가지만 정해 주세요' },
    });
    await drain();

    const room = await detail(chat.id);
    assert.equal(room.turns.length, 1, '받을 것(파일)이 없어도 다시 맡기지 않는다');
    assert.equal(room.card, null);
    assert.deepEqual(room.turns[0].brief, {
      summary: BRIEF.summary,
      questions: [{ ...BRIEF.questions[0] }, { ...BRIEF.questions[1], choices: [] }],
    });
    assert.ok(
      room.news.some((n: Json) => n.kind === 'question' && /확인할 것 2개를 물었어요/.test(n.text)),
      JSON.stringify(room.news),
    );

    // 관리자의 답 = 다음 회차의 메시지. 그 회차는 다시 묻지 않고 맡긴다
    ok(
      await api.request('POST', `/api/chats/${chat.id}/messages`, owner, {
        requestId: randomUUID(),
        version: room.chat.version,
        message: '목표 확인 답\n1. 누가 보나요? → 고객\n2. 꼭 넣을 숫자가 있나요? → 출시일과 가격',
      }),
      201,
    );
    const answered = await turnOf(chat.id, 2);
    assert.match(await refused(answered.run_token, 'ask_brief', BRIEF), /질문에 답한 회차/);
    await tool(answered.run_token, 'delegate_task', {
      subtasks: [
        {
          request_id: randomUUID(),
          to_agent_id: member.id,
          title: '페이지',
          instruction: '만들기',
        },
      ],
    });
    assert.equal((await detail(chat.id)).turns[1].brief, null);
  });

  test('대표가 아닌 에이전트 · 덧붙인 말의 답은 묻지 못한다', async () => {
    ok(
      await api.request('POST', '/api/tasks', owner, {
        requestId: randomUUID(),
        agentId: member.id,
        title: '그냥 일',
        instruction: '쓰기',
      }),
      201,
    );
    const jobs: Json[] = (await tool(runner, 'next_jobs', { limit: 5 })).jobs ?? [];
    const plain = jobs.find((j) => j.task.title === '그냥 일') as Json;
    assert.match(await refused(plain.run_token, 'ask_brief', BRIEF), /대표만/);
  });
});
