import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type TestUser } from '../../../testing/api-client';

// 요청 번호와 요청 로그 (리팩토링 6단계): 응답마다 X-Request-Id, 요청마다 로그 한 줄.
// 로그에는 번호 · 메서드 · 경로(쿼리 없이) · 상태 · 걸린 시간 · 요청자 종류 · MCP 도구만 있고, 토큰 · 쿼리 값은 없다.

let api: ApiClient;
let owner: TestUser;
let device: string;
const lines: { line: string; failed: boolean }[] = [];
const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** 이 번호의 로그 줄 (응답 뒤 close에서 남으므로 잠깐 기다린다) */
async function lineOf(id: string | null): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const found = lines.find((l) => l.line.startsWith(`${id} `));
    if (found) return found.line;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`요청 ${id}의 로그가 없어요`);
}

before(async () => {
  api = await ApiClient.start({ log: (line, failed) => lines.push({ line, failed }) });
  owner = await api.signIn();
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, {
    name: '돌무더기',
    siteUrl: api.baseUrl,
    version,
  });
  device = await api.connectDevice(owner, 'trace-laptop');
});

after(() => api.close());

describe('요청 번호', () => {
  test('응답마다 새 번호(UUIDv7)가 머리글에 붙고, 들어온 번호는 믿지 않는다', async () => {
    const first = await api.get('/api/space');
    const second = await api.request('GET', '/api/space', undefined, undefined, {
      'x-request-id': 'forged-request-id',
    });
    const a = first.header('x-request-id');
    const b = second.header('x-request-id');
    assert.match(String(a), UUID7);
    assert.match(String(b), UUID7);
    assert.notEqual(a, b);
    assert.ok(
      !lines.some((l) => l.line.includes('forged-request-id')),
      '들어온 번호는 로그에도 없다',
    );
  });
});

describe('요청 로그', () => {
  test('한 줄: 번호 · 메서드 · 경로 · 상태 · 걸린 시간 · 요청자. 쿼리 값은 남기지 않는다', async () => {
    const res = await api.get('/api/space?token=secret-value');
    const line = await lineOf(res.header('x-request-id'));
    assert.match(line, /^\S+ GET \/api\/space 200 \d+ms visitor$/);
    assert.ok(!line.includes('secret-value'));

    const mine = await api.get('/api/agents', owner);
    assert.match(await lineOf(mine.header('x-request-id')), / GET \/api\/agents 200 \d+ms owner$/);
  });

  test('거부도 남는다 (보통 등급). 토큰 값은 없다', async () => {
    const res = await api.request('GET', '/api/agents', undefined, undefined, {
      authorization: 'Bearer leaked-token-value',
    });
    const line = await lineOf(res.header('x-request-id'));
    assert.match(line, / GET \/api\/agents 403 \d+ms visitor$/);
    assert.ok(!lines.some((l) => l.line.includes('leaked-token-value')));
    assert.equal(lines.find((l) => l.line === line)?.failed, false);
  });

  test('MCP는 부른 도구 이름까지', async () => {
    const list = await api.mcp(device, 'tools/list');
    assert.match(
      await lineOf(list.header('x-request-id')),
      / POST \/mcp 200 \d+ms device tools\/list$/,
    );
    const call = await api.mcp(device, 'tools/call', { name: 'no_such_tool', arguments: {} });
    assert.match(
      await lineOf(call.header('x-request-id')),
      / POST \/mcp 200 \d+ms device no_such_tool$/,
    );
  });

  test('건강 확인의 2xx는 남기지 않는다 (Docker가 몇 초마다 부른다)', async () => {
    const res = await api.get('/api/health');
    assert.equal(res.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(!lines.some((l) => l.line.startsWith(`${res.header('x-request-id')} `)));
  });
});
