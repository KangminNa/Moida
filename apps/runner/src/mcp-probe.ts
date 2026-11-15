import type { ExternalMcp } from './external-mcp';

/** 도구 하나 (tools/list의 이름 · 설명) */
export type ProbedTool = { name: string; description: string };

/** 확인이 실패한 까닭. 화면에 그대로 보이므로 토큰 · 응답 본문을 싣지 않는다 */
export class ProbeFailed extends Error {}

/**
 * 커넥터 연결 확인 (2026-11-15 MCP 1단계, docs/MCP.md): 원격 MCP(Streamable HTTP)에 initialize → initialized →
 * tools/list를 보내 도구 목록을 받는다. 서버는 원격에 붙지 않고(SSRF) 러너가 한다.
 * 다른 곳으로 넘기면(3xx) 따라가지 않는다: 토큰을 실은 요청이 다른 주소로 가지 않게. 응답은 JSON이나 SSE(data: 줄)
 */
export class McpProbe {
  static readonly TIMEOUT_MS = 15_000;
  private static readonly PROTOCOL = '2025-06-18';
  private static readonly BODY_MAX = 1024 * 1024;
  private static readonly PAGES_MAX = 5;
  private static readonly TOOLS_MAX = 100;
  private nextId = 1;

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async tools(tool: ExternalMcp, signal: AbortSignal): Promise<readonly ProbedTool[]> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(McpProbe.TIMEOUT_MS)]);
    const opened = await this.send(
      tool,
      {},
      'initialize',
      {
        protocolVersion: McpProbe.PROTOCOL,
        capabilities: {},
        clientInfo: { name: 'cairn-runner', version: '1' },
      },
      deadline,
    );
    const session: Record<string, string> = {};
    if (opened.session) session['mcp-session-id'] = opened.session;
    const version = (opened.result as { protocolVersion?: unknown }).protocolVersion;
    if (typeof version === 'string') session['mcp-protocol-version'] = version;
    await this.notify(tool, session, deadline);
    const found: ProbedTool[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < McpProbe.PAGES_MAX && found.length < McpProbe.TOOLS_MAX; page++) {
      const listed = await this.send(
        tool,
        session,
        'tools/list',
        cursor ? { cursor } : {},
        deadline,
      );
      const result = listed.result as { tools?: unknown; nextCursor?: unknown };
      for (const t of Array.isArray(result.tools) ? result.tools : []) {
        const { name, description } = (t ?? {}) as { name?: unknown; description?: unknown };
        if (typeof name === 'string')
          found.push({ name, description: typeof description === 'string' ? description : '' });
      }
      cursor =
        typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null;
      if (cursor === null) break;
    }
    return found.slice(0, McpProbe.TOOLS_MAX);
  }

  private async send(
    tool: ExternalMcp,
    session: Record<string, string>,
    method: string,
    params: object,
    signal: AbortSignal,
  ): Promise<{ result: object; session: string | null }> {
    const id = this.nextId++;
    const res = await this.post(tool, session, { jsonrpc: '2.0', id, method, params }, signal);
    const message = McpProbe.messageOf(await McpProbe.body(res), id);
    const error = (message as { error?: { message?: unknown } }).error;
    if (error)
      throw new ProbeFailed(`MCP 오류: ${String(error.message ?? '알 수 없음').slice(0, 200)}`);
    const result = (message as { result?: unknown }).result;
    if (typeof result !== 'object' || result === null) throw new ProbeFailed('MCP 응답이 아니에요');
    return { result, session: res.headers.get('mcp-session-id') };
  }

  private async notify(tool: ExternalMcp, session: Record<string, string>, signal: AbortSignal) {
    const body = { jsonrpc: '2.0', method: 'notifications/initialized' };
    await (await this.post(tool, session, body, signal)).body?.cancel();
  }

  private async post(
    tool: ExternalMcp,
    session: Record<string, string>,
    body: object,
    signal: AbortSignal,
  ): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetcher(tool.url, {
        method: 'POST',
        redirect: 'manual',
        signal,
        headers: {
          ...tool.headers,
          ...session,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      const timedOut = (error as Error).name === 'TimeoutError';
      throw new ProbeFailed(timedOut ? '15초 안에 답이 없어요' : '연결하지 못했어요');
    }
    if (res.status >= 300 && res.status < 400)
      throw new ProbeFailed('다른 주소로 넘겨서 따라가지 않았어요');
    if (res.status === 401 || res.status === 403)
      throw new ProbeFailed(`토큰을 확인해요 (${res.status})`);
    if (!res.ok) throw new ProbeFailed(`HTTP ${res.status}`);
    return res;
  }

  /** 응답 본문 (1MB까지, 넘으면 그만 읽는다): JSON 하나이거나 SSE의 data: 줄들 */
  private static async body(res: Response): Promise<string> {
    if (!res.body) return '';
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > McpProbe.BODY_MAX) {
        await reader.cancel();
        throw new ProbeFailed('응답이 너무 커요');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  /** 이 요청(id)에 대한 JSON-RPC 메시지 */
  static messageOf(text: string, id: number): object {
    const candidates = text.trimStart().startsWith('{')
      ? [text]
      : text
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim());
    for (const raw of candidates) {
      try {
        const message = JSON.parse(raw) as { id?: unknown };
        if (message && typeof message === 'object' && message.id === id) return message;
      } catch {
        // JSON이 아닌 줄은 넘어간다
      }
    }
    throw new ProbeFailed('MCP 응답이 아니에요');
  }
}
