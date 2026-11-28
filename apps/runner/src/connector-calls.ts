import { ExternalMcp } from './external-mcp';

/** 서버에 보내는 한 줄 (submit_result의 result.connector_calls) */
export type ConnectorCall = { name: string; calls: number; failures: number; error?: string };

/**
 * 이 실행에서 커넥터(x-<이름> MCP 서버)의 도구를 부른 수와 실패 수 (2026-11-15 MCP 1단계, docs/MCP.md).
 * Claude는 tool_use(mcp__x-notion__search)와 그 결과의 is_error로, Codex는 mcp_tool_call 항목으로 센다.
 * 서버는 마지막 사용 · 실패만 커넥터에 적는다. 오류 글은 보내기 전에 지운다(Redactor, MoidaServer.submit)
 */
export class ConnectorCalls {
  private static readonly ERROR_MAX = 300;
  private readonly byServer = new Map<
    string,
    { calls: number; failures: number; error?: string }
  >();
  /** 부른 호출 id → 서버 이름 (실패를 나중에 받는 도구용) */
  private readonly byCall = new Map<string, string>();

  /** Claude의 도구 이름(mcp__<서버>__<도구>)에서 서버 이름. MCP 도구가 아니면 null */
  static serverOf(toolName: string): string | null {
    const match = /^mcp__(.+?)__/.exec(toolName);
    return match?.[1] ?? null;
  }

  /** 부름 하나. 커넥터(x-)가 아니면 세지 않는다 */
  called(server: string, callId = ''): void {
    if (!server.startsWith(ExternalMcp.PREFIX) || (callId !== '' && this.byCall.has(callId)))
      return;
    const line = this.byServer.get(server) ?? { calls: 0, failures: 0 };
    line.calls += 1;
    this.byServer.set(server, line);
    if (callId) this.byCall.set(callId, server);
  }

  /** 실패 하나: 서버 이름이나 부를 때의 호출 id로 */
  failed(serverOrCall: string, error: string): void {
    const server = this.byCall.get(serverOrCall) ?? serverOrCall;
    const line = this.byServer.get(server);
    if (!line) return;
    line.failures = Math.min(line.failures + 1, line.calls);
    line.error = error.replace(/\s+/g, ' ').trim().slice(0, ConnectorCalls.ERROR_MAX) || undefined;
  }

  /** 서버에 보낼 줄 (이름은 x-를 뺀 커넥터 이름) */
  get lines(): readonly ConnectorCall[] {
    return [...this.byServer.entries()].map(([server, line]) => ({
      name: server.slice(ExternalMcp.PREFIX.length),
      ...line,
    }));
  }
}
