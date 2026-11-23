import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';

// 작업 기록의 휴지통 (2026-11-23 일괄 지우기): 끝난 작업만 목록에서 빼고(줄은 남는다) 꺼낼 수 있다. 주인만

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 테스트 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

/** 작업 하나를 만든다 (담당 없이 대기열에) */
async function newTask(title: string): Promise<Json> {
  return ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: null,
      kind: 'general',
      title,
      instruction: '정리해 줘',
    }),
    201,
  );
}

const cancel = async (task: Json) =>
  ok(await api.request('POST', `/api/tasks/${task.id}/cancel`, owner, { version: task.version }));
const listed = async (query = '') =>
  (ok(await api.get(`/api/tasks${query}`, owner)).tasks as Json[]).map((t) => t.id);

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
});
after(() => api.close());

describe('작업 기록의 휴지통', () => {
  test('방문자 · write 기기는 넣지도 꺼내지도 못한다', async () => {
    const writer = {
      authorization: `Bearer ${await api.writeDevice(owner, `trash-writer-${randomUUID().slice(0, 6)}`)}`,
    };
    for (const headers of [{}, writer])
      for (const path of ['/api/tasks/trash', '/api/tasks/restore']) {
        const res = await api.request(
          'POST',
          path,
          TestUser.visitor,
          { ids: [randomUUID()] },
          headers,
        );
        assert.ok([401, 403].includes(res.status), `${path} ${res.status}`);
      }
  });

  test('고른 것 중 끝난 작업만 넣고, 꺼낼 수 있다. 끝난 작업 모두도', async () => {
    const open = await newTask(`도는 일 ${randomUUID()}`);
    const finished = await cancel(await newTask(`끝난 일 ${randomUUID()}`));
    const other = await cancel(await newTask(`다른 끝난 일 ${randomUUID()}`));
    const picked = ok(
      await api.request('POST', '/api/tasks/trash', owner, { ids: [open.id, finished.id] }),
    );
    assert.equal(picked.count, 1, '도는 작업은 넘어간다');
    assert.ok(!(await listed()).includes(finished.id), '목록에서 빠진다');
    assert.ok((await listed()).includes(open.id));
    assert.ok((await listed('?trash=1')).includes(finished.id), '휴지통에 보인다');
    assert.equal(
      ok(await api.get(`/api/tasks/${finished.id}`, owner)).id,
      finished.id,
      '줄은 남는다',
    );

    const all = ok(await api.request('POST', '/api/tasks/trash', owner, { finished: true }));
    assert.ok(all.count >= 1);
    assert.ok((await listed('?trash=1')).includes(other.id));
    assert.ok((await listed()).includes(open.id), '도는 작업은 그대로');

    const back = ok(
      await api.request('POST', '/api/tasks/restore', owner, { ids: [finished.id, other.id] }),
    );
    assert.equal(back.count, 2);
    assert.ok((await listed()).includes(finished.id));
    assert.equal((await api.request('POST', '/api/tasks/trash', owner, { ids: [] })).status, 400);
    assert.equal(
      (await api.request('POST', '/api/tasks/restore', owner, { finished: true })).status,
      400,
      '꺼내기는 고른 것만',
    );
  });
});
