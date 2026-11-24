import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database } from '../../platform';

// 대표 (O-2, docs/서브나.md 14장): 공간마다 숨은 에이전트 하나. 첫 대화에서 생기고, 목록 · 조직도에 보이지 않는다.
// 관리자는 설정 › AI에서 AI 도구 · 모델 · 생각 강도 · 한도 · 검토자만 바꾼다. 아무도 대표에게 보고하지 않고, 지우지 못한다.

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
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
const patch = async (body: Json) => {
  const now = await lead();
  return api.request('PATCH', `/api/agents/${now.id}`, owner, { version: now.version, ...body });
};

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
});
after(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
  await api.close();
});

describe('대표 (O-2)', () => {
  test('첫 대화에서 생기고 GET api/agents/lead로만 읽는다. 목록에는 없다. 방문자는 403', async () => {
    assert.equal((await api.get('/api/agents/lead', TestUser.visitor)).status, 403);
    const before = await lead();
    if (before === null) {
      ok(
        await api.request('POST', '/api/chats', owner, {
          requestId: randomUUID(),
          message: '대표를 만드는 첫 대화',
        }),
        201,
      );
    }
    const boss = await lead();
    assert.deepEqual(
      [boss.name, 'scopes' in boss, 'reportsTo' in boss, boss.approvalActions],
      ['아리', false, false, ['browser.site.publish', 'browser.site.login']],
    );
    const listed = ok(await api.get('/api/agents', owner)).agents as Json[];
    assert.ok(!listed.some((a) => a.id === boss.id), '일꾼 목록에 보이지 않는다');
    const again = ok(
      await api.request('POST', '/api/chats', owner, { requestId: randomUUID(), message: '또' }),
      201,
    );
    assert.equal(again.agentId, boss.id, '대표는 공간에 하나');
    await assert.rejects(
      db.sql`
        INSERT INTO task.agents (space_id, name, tool, scopes, lead)
        SELECT space_id, '둘째 대표', 'claude', ARRAY['read_public'], true FROM task.agents WHERE id = ${boss.id}`,
      /agents_one_lead/,
      'DB도 공간마다 하나만 받는다',
    );
  });

  test('관리자는 이름 · AI 도구 · 모델 · 생각 강도 · 한도 · 검토자만 바꾼다. 역할 · 승인 동작 · 러너는 422', async () => {
    const changed = ok(
      await patch({ model: 'opus', effort: 'high', monthlyLimit: 500000, fiveHourLimit: 100000 }),
    );
    assert.deepEqual(
      [changed.model, changed.effort, changed.monthlyLimit, changed.fiveHourLimit],
      ['opus', 'high', 500000, 100000],
    );
    const named = ok(await patch({ name: '하루' }));
    assert.equal(named.name, '하루', '대표에게 이름을 붙인다 (2026-11-24)');
    ok(await patch({ name: '아리' }));
    for (const body of [
      { role: '다른 일' },
      { approvalActions: ['blog.post.publish'] },
      { runnerId: null },
    ]) {
      const res = await patch(body);
      assert.equal(res.status, 422, `${JSON.stringify(body)} ${res.text}`);
    }
    const reviewer = await agent('검토', { tool: 'codex' });
    assert.equal(ok(await patch({ reviewerId: reviewer.id })).reviewerId, reviewer.id);
    ok(await patch({ reviewerId: null }));
  });

  test('대표는 지우지 못한다 (422)', async () => {
    const boss = await lead();
    const gone = await api.request('POST', `/api/agents/${boss.id}/delete`, owner, {
      version: boss.version,
    });
    assert.equal(gone.status, 422, gone.text);
    assert.match(gone.text, /대표는 지울 수 없어요/);
  });
});
