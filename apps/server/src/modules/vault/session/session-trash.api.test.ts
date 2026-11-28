import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';

// 세션 휴지통 (2026-11-19 휴지통 A): 관리자가 휴지통으로 보내면 목록 · 상세에서 빠지고 휴지통 목록에 보인다.
// 판은 지우지 않아 되살리면 돌아온다. 휴지통에 있는 동안 같은 대화가 다시 올라와도 휴지통에 남는다

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let laptop: string;
const mark = randomUUID().slice(0, 8);

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

/** save_session 한 번 → 세션 id */
async function save(source: string, did: string): Promise<string> {
  const res = await api.mcp(laptop, 'tools/call', {
    name: 'save_session',
    arguments: {
      request_id: randomUUID(),
      source_session_id: source,
      tool: 'claude-code',
      project: 'moida',
      title: `휴지통 ${mark}`,
      did,
    },
  });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as { isError?: boolean; structuredContent?: Json };
  assert.ok(!result.isError, res.text);
  return String(result.structuredContent?.session_id);
}

const listed = async (id: string): Promise<boolean> =>
  (ok(await api.get('/api/sessions', owner)).sessions as Json[]).some((s) => s.id === id);
const trashed = async (): Promise<Json[]> =>
  ok(await api.get('/api/sessions/trash', owner)).sessions as Json[];

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, {
    name: '돌무더기',
    siteUrl: api.baseUrl,
    version,
  });
  laptop = await api.connectDevice(owner, `trash-laptop-${mark}`);
});
after(() => api.close());

describe('세션 휴지통', () => {
  test('휴지통으로 보내면 목록 · 상세에서 빠지고, 다시 올라와도 휴지통에 남고, 되살리면 돌아온다', async () => {
    const source = randomUUID();
    const id = await save(source, '휴지통으로 보낼 세션');
    const detail = ok(await api.get(`/api/sessions/${id}`, owner));
    const moved = ok(
      await api.request('POST', `/api/sessions/${id}/trash`, owner, { version: detail.version }),
    );
    assert.equal(typeof moved.trashedAt, 'string');
    assert.equal(typeof moved.changeSetId, 'string');
    assert.equal(await listed(id), false);
    assert.equal((await api.get(`/api/sessions/${id}`, owner)).status, 404);
    const line = (await trashed()).find((s) => s.id === id);
    assert.ok(line, '휴지통 목록에 보인다');

    // 같은 대화가 다시 올라와도 같은 세션에 판이 쌓이고 휴지통에 남는다
    assert.equal(await save(source, '휴지통에 있는 동안 이어 쓴 것'), id);
    assert.equal(await listed(id), false);

    const stale = await api.request('POST', `/api/sessions/${id}/restore`, owner, {
      version: detail.version,
    });
    assert.equal(stale.status, 409, stale.text);
    const now = (await trashed()).find((s) => s.id === id) as Json;
    const back = ok(
      await api.request('POST', `/api/sessions/${id}/restore`, owner, { version: now.version }),
    );
    assert.equal(back.trashedAt, null);
    assert.equal(await listed(id), true);
    const revisions = ok(await api.get(`/api/sessions/${id}`, owner)).revisionCount;
    assert.equal(revisions, 2, '휴지통에 있는 동안 쌓인 판도 남는다');
  });

  test('휴지통은 관리자만 (방문자 · write 기기는 403)', async () => {
    const id = await save(randomUUID(), '남이 지우지 못하는 세션');
    const detail = ok(await api.get(`/api/sessions/${id}`, owner));
    const writer = {
      authorization: `Bearer ${await api.writeDevice(owner, `trash-writer-${mark}`)}`,
    };
    for (const headers of [{}, writer]) {
      const res = await api.request(
        'POST',
        `/api/sessions/${id}/trash`,
        TestUser.visitor,
        { version: detail.version },
        headers,
      );
      assert.equal(res.status, 403, res.text);
    }
    assert.equal((await api.get('/api/sessions/trash')).status, 403);
    assert.equal(await listed(id), true);
  });
});
