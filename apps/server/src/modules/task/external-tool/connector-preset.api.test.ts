import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, type TestUser } from '../../../testing/api-client';
import { Database } from '../../platform';

// 추천 커넥터 (C2, 2026-11-28): GET api/external-tools/presets는 저장소의 공식 원격 MCP 목록과 이미 더했는지,
// POST api/external-tools/presets/:key는 그 칸으로 커넥터를 만들고 지우지 않은 모든 에이전트에게 허락한다 (관리자만)

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 테스트 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
});

after(() => api.close());

describe('추천 커넥터 (C2)', () => {
  test('목록 · 더하기 · 모든 일꾼에게 허락 · 같은 이름은 409 · 관리자만', async () => {
    assert.equal((await api.get('/api/external-tools/presets')).status, 403);
    const listed = ok(await api.get('/api/external-tools/presets', owner)).presets as Json[];
    const notion = listed.find((p) => p.key === 'notion') as Json;
    assert.deepEqual(
      [notion.title, notion.url, notion.auth, notion.added],
      ['Notion', 'https://mcp.notion.com/mcp', 'oauth', false],
    );

    const worker = ok(
      await api.request('POST', '/api/agents', owner, {
        requestId: randomUUID(),
        name: `추천 ${randomUUID().slice(0, 6)}`,
        tool: 'claude',
      }),
      201,
    );
    const requestId = randomUUID();
    const body = { requestId };
    assert.equal(
      (await api.request('POST', '/api/external-tools/presets/notion', undefined, body)).status,
      403,
    );
    const made = ok(
      await api.request('POST', '/api/external-tools/presets/notion', owner, body),
      201,
    );
    assert.deepEqual(
      [made.name, made.auth, made.url],
      ['notion', 'oauth', 'https://mcp.notion.com/mcp'],
    );
    const again = ok(
      await api.request('POST', '/api/external-tools/presets/notion', owner, body),
      201,
    );
    assert.equal(again.id, made.id, '같은 requestId는 처음 만든 것');
    const [allowed] = await db.sql`SELECT external_tools FROM task.agents WHERE id = ${worker.id}`;
    assert.ok((allowed as Json).external_tools.includes('notion'), '일꾼에게 허락');

    assert.equal(
      (
        await api.request('POST', '/api/external-tools/presets/notion', owner, {
          requestId: randomUUID(),
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await api.request('POST', '/api/external-tools/presets/nothing', owner, {
          requestId: randomUUID(),
        })
      ).status,
      404,
    );
    const added = ok(await api.get('/api/external-tools/presets', owner)).presets as Json[];
    assert.equal(added.find((p) => p.key === 'notion')?.added, true);
    // 뒤의 테스트가 같은 이름을 쓸 수 있게 지운다 (일꾼의 허락도 함께 빠진다)
    const removed = await api.request('POST', `/api/external-tools/${made.id}/delete`, owner, {
      version: made.version,
    });
    assert.equal(removed.status, 204, removed.text);
  });
});
