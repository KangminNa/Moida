import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database } from '../../platform';

// 대화 휴지통 (2026-11-19 휴지통 A): 휴지통으로 보내면 멈추기처럼 도는 일을 취소하고 목록 · 상세에서 뺀다.
// 휴지통의 대화에는 보내지 못하고(404), 되살리면 다시 보낸다. 이 대화로 보내는 자동화가 있으면 409

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 테스트 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

const open = async (message: string): Promise<Json> =>
  ok(await api.request('POST', '/api/chats', owner, { requestId: randomUUID(), message }), 201);
const listed = async (id: unknown): Promise<boolean> =>
  (ok(await api.get('/api/chats', owner)).chats as Json[]).some((c) => c.id === id);
const send = (chat: Json, version: number) =>
  api.request('POST', `/api/chats/${chat.id}/messages`, owner, {
    requestId: randomUUID(),
    version,
    message: '이어서',
  });

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
});
after(() => api.close());

describe('대화 휴지통', () => {
  test('휴지통으로 보내면 도는 회차가 멈추고 목록 · 상세에서 빠지며, 되살리면 다시 보낸다', async () => {
    const chat = await open('휴지통으로 보낼 대화');
    const [turn] = ok(await api.get(`/api/chats/${chat.id}`, owner)).turns as Json[];
    const moved = ok(
      await api.request('POST', `/api/chats/${chat.id}/trash`, owner, { version: chat.version }),
    );
    assert.equal(await listed(chat.id), false);
    assert.equal((await api.get(`/api/chats/${chat.id}`, owner)).status, 404);
    assert.equal((await send(chat, moved.version)).status, 404);
    const task = ok(await api.get(`/api/tasks/${turn?.taskId}`, owner));
    assert.equal(task.status, 'cancelled', '도는 회차는 멈춘다');

    const trash = ok(await api.get('/api/chats/trash', owner)).chats as Json[];
    const line = trash.find((c) => c.id === chat.id) as Json;
    assert.equal(typeof line.trashedAt, 'string');
    const stale = await api.request('POST', `/api/chats/${chat.id}/restore`, owner, {
      version: chat.version,
    });
    assert.equal(stale.status, 409, stale.text);
    const back = ok(
      await api.request('POST', `/api/chats/${chat.id}/restore`, owner, { version: line.version }),
    );
    assert.equal(await listed(chat.id), true);
    ok(await send(chat, back.version), 201);
  });

  test('이 대화로 보내는 자동화가 있으면 409', async () => {
    const chat = await open('자동화가 보내는 대화');
    const schedule = ok(
      await api.request('POST', '/api/schedules', owner, {
        requestId: randomUUID(),
        title: '대화로 보내는 자동화',
        enabled: false,
        mode: 'daily',
        atTime: '09:30',
        weekdays: [1, 2, 3, 4, 5],
        timeZone: 'Asia/Seoul',
        instruction: '정리해 줘',
        dailyMax: 1,
        agentId: null,
        destination: 'chat',
      }),
      201,
    );
    // 레시피가 처음 돌며 연 대화를 기억한 것과 같게 (Schedule.openedChat)
    await api.service(Database).sql`
      UPDATE task.schedules SET chat_id = ${String(chat.id)} WHERE id = ${String(schedule.id)}`;
    const refused = await api.request('POST', `/api/chats/${chat.id}/trash`, owner, {
      version: chat.version,
    });
    assert.equal(refused.status, 409, refused.text);
    assert.match(refused.text, /자동화/);
    assert.equal(await listed(chat.id), true);
  });

  test('휴지통은 관리자만 (방문자 · write 기기는 403)', async () => {
    const chat = await open('남이 지우지 못하는 대화');
    const writer = { authorization: `Bearer ${await api.writeDevice(owner, 'chat-trash-writer')}` };
    for (const headers of [{}, writer]) {
      const res = await api.request(
        'POST',
        `/api/chats/${chat.id}/trash`,
        TestUser.visitor,
        { version: chat.version },
        headers,
      );
      assert.equal(res.status, 403, res.text);
    }
    assert.equal((await api.get('/api/chats/trash')).status, 403);
  });
});
