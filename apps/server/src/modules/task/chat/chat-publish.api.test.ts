import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, type TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker, SystemActor } from '../../platform';
import { AppCodeAddedInput } from './chat.input';
import { ChatResultService } from './chat-result.service';

// 대화에서 앱 배포 · 수정 (2026-11-24, MCP publish_app, 원칙 7의 예외): 관리자가 콘솔의 대화에 쓴 배포 · 수정 요청을
// 대표가 글자 그대로 인용하면 서버가 확인하고 바로 반영한다. 인용이 관리자의 말이 아니거나 하지 말라는 말이면 거절한다

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 테스트 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let worker: OutboxWorker;
let runner: string;
const RUNNER = `chat-publish-${randomUUID().slice(0, 6)}`;

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

async function refused(token: string, name: string, args: Json = {}): Promise<string> {
  const res = await call(token, name, args);
  const result = (res.json() as Json).result;
  assert.equal(result.isError, true, JSON.stringify(result));
  return JSON.stringify(result.content);
}

/** 관리자가 새 대화를 열고, 대표의 첫 회차를 빌린다 */
async function chatTurn(message: string): Promise<{ chatId: string; job: Json }> {
  const chat = ok(
    await api.request('POST', '/api/chats', owner, { requestId: randomUUID(), message }),
    201,
  );
  const jobs: Json[] = (await tool(runner, 'next_jobs', { limit: 5 })).jobs ?? [];
  const job = jobs.find((j) => j.task.payload.chat?.chatId === chat.id);
  assert.ok(job, '첫 회차가 빌려지지 않았다');
  return { chatId: String(chat.id), job };
}

async function newApp(kind: string, visibility: 'private' | 'public' = 'private'): Promise<Json> {
  const slug = `pub-${randomUUID().slice(0, 8)}`;
  const app = ok(
    await api.request('POST', '/api/apps', owner, {
      requestId: randomUUID(),
      kind,
      name: slug,
      slug,
    }),
    201,
  );
  if (visibility === 'private') return app;
  return ok(
    await api.request('PATCH', `/api/apps/${app.id}`, owner, {
      version: app.version,
      visibility: 'public',
    }),
  );
}

const appOf = async (id: string): Promise<Json> =>
  ((ok(await api.get('/api/apps', owner)).apps as Json[]).find((a) => a.id === id) ?? {}) as Json;

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '배포', siteUrl: api.baseUrl, version });
  runner = await api.connectDevice(owner, RUNNER);
  const { devices } = ok(await api.get('/api/devices', owner)) as { devices: Json[] };
  const device = devices.find((d) => d.name === RUNNER) as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...device.scopes, 'run'],
      version: device.version,
    }),
  );
});

after(() => api.close());

beforeEach(async () => {
  await drain();
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});

describe('대화에서 배포 (publish_app)', () => {
  test('관리자가 "배포해줘"라고 쓰면 대표가 그 말을 인용해 비공개 앱을 공개로 바꾼다 (클릭 없이, 기록은 남는다)', async () => {
    const app = await newApp('page');
    const { chatId, job } = await chatTurn('일정표 앱 만들어서 바로 배포해줘');
    const done = await tool(job.run_token, 'publish_app', { app_id: app.id, quote: '배포해줘' });
    assert.deepEqual([done.scope, done.made_public, done.versions_shown], ['ship', true, 0]);
    await drain();
    assert.equal((await appOf(app.id)).visibility, 'public');
    const [row] = await db.sql<Json[]>`
      SELECT status, agent_decided, note, payload FROM task.approvals
      WHERE chat_id = ${chatId} AND action = 'blog.app.publish'`;
    assert.deepEqual(
      [row?.status, row?.agent_decided, row?.payload?.scope],
      ['approved', true, 'ship'],
    );
    assert.match(String(row?.note), /대화에서 관리자가 요청: «배포해줘»/);
  });

  test('관리자가 쓰지 않은 말 · 하지 말라는 말 · 요청이 아닌 말은 거절한다', async () => {
    const app = await newApp('page');
    const { job } = await chatTurn('화면 디자인만 먼저 보여 줘. 아직 배포하지 마');
    assert.match(
      await refused(job.run_token, 'publish_app', { app_id: app.id, quote: '배포해줘' }),
      /관리자가 콘솔로 보낸 말이 아니에요/,
    );
    assert.match(
      await refused(job.run_token, 'publish_app', { app_id: app.id, quote: '배포' }),
      /하지 말라는 말이에요/,
    );
    assert.match(
      await refused(job.run_token, 'publish_app', { app_id: app.id, quote: '화면 디자인만' }),
      /배포 · 공개나 수정을 요청한 말이 아니에요/,
    );
    await drain();
    assert.equal((await appOf(app.id)).visibility, 'private');
  });

  test('고쳐 달라는 말이면 공개 여부는 그대로, 이 대화의 그 앱의 새 버전은 카드 없이 바로 승인된다', async () => {
    const app = await newApp('page', 'public');
    const { chatId, job } = await chatTurn('첫 화면 버튼 색을 초록으로 바꿔줘');
    const done = await tool(job.run_token, 'publish_app', {
      app_id: app.id,
      quote: '버튼 색을 초록으로 바꿔줘',
    });
    assert.deepEqual([done.scope, done.made_public], ['edit', false]);
    // 이 대화의 만들기 일이 낸 확인 대기 버전 (blog.app_code.added가 오는 것과 같다)
    const [found] = await db.sql<{ space_id: string }[]>`
      SELECT space_id FROM blog.apps WHERE id = ${app.id}`;
    const spaceId = String(found?.space_id);
    const added = { appId: app.id, name: app.name, seq: 2, pending: true, taskId: job.task.id };
    await api
      .service(ChatResultService)
      .offerAppCode(new SystemActor(), spaceId, AppCodeAddedInput.from(added));
    const [shown] = await db.sql<Json[]>`
      SELECT status, agent_decided, card_id FROM task.approvals
      WHERE chat_id = ${chatId} AND action = 'blog.app_code.show'`;
    assert.deepEqual(
      [shown?.status, shown?.agent_decided, shown?.card_id],
      ['approved', true, null],
    );
  });

  test('도메인을 확인하지 않은 커뮤니티는 공개하지 못한다 (까닭을 돌려준다)', async () => {
    const app = await newApp('community');
    const { job } = await chatTurn('커뮤니티 배포해줘');
    assert.match(
      await refused(job.run_token, 'publish_app', { app_id: app.id, quote: '배포해줘' }),
      /도메인 연결을 확인한 뒤에 공개할 수 있어요/,
    );
  });
});
