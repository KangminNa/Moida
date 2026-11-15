import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ExternalMcp } from './external-mcp';
import { Json } from './json';
import { McpProbe, ProbeFailed } from './mcp-probe';

// 커넥터 연결 확인 (2026-11-15 MCP 1단계). 네트워크 없이 가짜 fetch로 원격 MCP의 답을 흉내 낸다

const [tool] = ExternalMcp.list([
  Json.of({
    name: 'notion',
    url: 'https://mcp.example.com/mcp',
    headers: { Authorization: 'Bearer t0k' },
  }),
]);
if (!tool) throw new Error('도구가 있어야 해요');

type Sent = {
  headers: Record<string, string>;
  body: { method: string; id?: number; params?: unknown };
};

/** 요청마다 답을 만드는 가짜 원격 MCP */
function fakeServer(answer: (sent: Sent) => Response) {
  const sent: Sent[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    const one = {
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    };
    sent.push(one);
    return answer(one);
  }) as unknown as typeof fetch;
  return { sent, probe: new McpProbe(fetcher) };
}

const json = (body: object, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('McpProbe', () => {
  test('initialize → initialized → tools/list (쪽 넘기기), 세션 머리글을 이어 보낸다', async () => {
    const { sent, probe } = fakeServer(({ body }) => {
      if (body.method === 'initialize')
        return json(
          { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } },
          { 'mcp-session-id': 's1' },
        );
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const cursor = (body.params as { cursor?: string }).cursor;
      const tools = cursor ? [{ name: 'fetch' }] : [{ name: 'search', description: '문서 찾기' }];
      // 두 번째 쪽은 SSE로
      if (cursor)
        return new Response(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools } })}\n\n`,
          {
            headers: { 'content-type': 'text/event-stream' },
          },
        );
      return json({ jsonrpc: '2.0', id: body.id, result: { tools, nextCursor: 'p2' } });
    });
    const tools = await probe.tools(tool, new AbortController().signal);
    assert.deepEqual(tools, [
      { name: 'search', description: '문서 찾기' },
      { name: 'fetch', description: '' },
    ]);
    assert.deepEqual(
      sent.map((s) => s.body.method),
      ['initialize', 'notifications/initialized', 'tools/list', 'tools/list'],
    );
    assert.equal(sent[0]?.headers.Authorization, 'Bearer t0k');
    assert.equal(sent[2]?.headers['mcp-session-id'], 's1');
    assert.equal(sent[2]?.headers['mcp-protocol-version'], '2025-06-18');
  });

  test('401 · 다른 주소로 넘기기 · MCP 오류는 까닭만 (토큰 · 본문 없이)', async () => {
    const cases: [Response, RegExp][] = [
      [new Response('nope Bearer t0k', { status: 401 }), /토큰을 확인해요 \(401\)/],
      [
        new Response(null, { status: 302, headers: { location: 'https://evil.example' } }),
        /따라가지 않았어요/,
      ],
      [
        json({ jsonrpc: '2.0', id: 1, error: { code: -1, message: '없는 방법' } }),
        /MCP 오류: 없는 방법/,
      ],
      [new Response('<html>로그인</html>', { status: 200 }), /MCP 응답이 아니에요/],
    ];
    for (const [res, why] of cases) {
      const { probe } = fakeServer(() => res);
      await assert.rejects(probe.tools(tool, new AbortController().signal), (e: Error) => {
        assert.ok(e instanceof ProbeFailed);
        assert.match(e.message, why);
        assert.ok(!e.message.includes('t0k'));
        return true;
      });
    }
  });

  test('1MB가 넘는 답은 그만 읽는다', async () => {
    const { probe } = fakeServer(() => new Response('x'.repeat(1024 * 1024 + 10)));
    await assert.rejects(probe.tools(tool, new AbortController().signal), /너무 커요/);
  });

  test('연결 실패는 까닭만', async () => {
    const probe = new McpProbe((async () => {
      throw new TypeError('fetch failed: getaddrinfo ENOTFOUND');
    }) as unknown as typeof fetch);
    await assert.rejects(
      probe.tools(tool, new AbortController().signal),
      /^ProbeFailed: 연결하지 못했어요$|연결하지 못했어요/,
    );
  });
});

describe('ExternalMcp의 도구 줄', () => {
  test('catalog를 한 줄씩 지시문에, 없으면 MCP로 받는다고', () => {
    const [withLines, bare] = ExternalMcp.list([
      Json.of({
        name: 'notion',
        url: 'https://a.example/mcp',
        catalog: ['search — 찾기', 3, ' fetch\n— 열기 '],
      }),
      Json.of({ name: 'linear', url: 'https://b.example/mcp' }),
    ]);
    assert.equal(withLines?.promptLines, '- x-notion\n  - search — 찾기\n  - fetch — 열기');
    assert.equal(bare?.promptLines, '- x-linear (도구 목록은 MCP로 받습니다)');
  });
});
