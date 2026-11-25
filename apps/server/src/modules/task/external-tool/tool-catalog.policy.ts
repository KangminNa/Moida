/** 커넥터의 도구 하나 (external_tools.catalog의 한 줄) */
export type ToolLine = { name: string; description: string };
/** 에이전트의 일 하나에서 커넥터 하나를 부른 수 (러너의 submit_result.result.connector_calls) */
export type ToolCalls = { name: string; calls: number; failures: number; error: string | null };
/** 승인한 도구 목록과 새로 받은 목록의 차이 (C3 바뀜 감지) */
export type ToolDrift = {
  added: ToolLine[];
  changed: { name: string; before: string; after: string }[];
  removed: string[];
};

// 커넥터의 도구 목록과 사용 기록 (2026-11-15 MCP 1단계, docs/MCP.md). 러너가 보낸 값이라 믿지 않는 입력으로 거른다:
// 모양이 틀린 줄은 버리고, 개수 · 길이를 자른다. 비밀값은 러너가 지운 뒤 보낸다 (오류 글에 토큰이 남지 않게)
export class ToolCatalog {
  /** 저장하는 도구 수 (DB CHECK와 같다) */
  static readonly MAX = 100;
  /** 일을 빌려 줄 때 지시문에 싣는 줄 수 (AI CLI는 MCP로 설명을 따로 받는다: 순서를 정할 만큼만) */
  static readonly JOB_LINES = 30;
  private static readonly NAME = /^[A-Za-z0-9_.-]{1,100}$/;
  private static readonly SERVER = /^[a-z][a-z0-9-]{1,29}$/;
  private static readonly DESCRIPTION_MAX = 300;
  private static readonly LINE_MAX = 120;
  private static readonly ERROR_MAX = 500;
  private static readonly CALLS_MAX = 100_000;

  /** tool_check 결과의 도구 목록 ({ tools: [{ name, description }] }). 없거나 틀리면 빈 목록 */
  static of(result: unknown): ToolLine[] {
    const tools = (result as { tools?: unknown } | null)?.tools;
    if (!Array.isArray(tools)) return [];
    const lines = tools.flatMap((t): ToolLine[] => {
      const { name, description } = (t ?? {}) as { name?: unknown; description?: unknown };
      if (typeof name !== 'string' || !ToolCatalog.NAME.test(name)) return [];
      const said = typeof description === 'string' ? ToolCatalog.oneLine(description) : '';
      return [{ name, description: said.slice(0, ToolCatalog.DESCRIPTION_MAX) }];
    });
    return lines
      .filter((l, i) => lines.findIndex((o) => o.name === l.name) === i)
      .slice(0, ToolCatalog.MAX);
  }

  /**
   * 끝난 확인 일의 결과: 도구 목록 또는 실패 까닭. 끝났는데 목록 칸이 없으면 실패로 본다
   * (확인 일을 모르는 옛 러너가 AI로 돌린 것: 빈 목록을 성공으로 적지 않게)
   */
  static checked(
    done: boolean,
    result: unknown,
  ): { catalog: ToolLine[] | null; error: string | null } {
    const body = (result ?? {}) as { tools?: unknown; error?: unknown };
    if (done && Array.isArray(body.tools)) return { catalog: ToolCatalog.of(result), error: null };
    if (done)
      return { catalog: null, error: '도구 목록이 오지 않았어요. 러너를 새 버전으로 바꿔요' };
    return {
      catalog: null,
      error: ToolCatalog.errorOf(typeof body.error === 'string' ? body.error : null),
    };
  }

  /** 에이전트의 일 결과에 실린 커넥터 사용 (connector_calls). 모양이 틀린 줄은 버린다 */
  static usage(result: unknown): ToolCalls[] {
    const calls = (result as { connector_calls?: unknown } | null)?.connector_calls;
    if (!Array.isArray(calls)) return [];
    return calls.flatMap((c): ToolCalls[] => {
      const { name, calls: n, failures, error } = (c ?? {}) as Record<string, unknown>;
      if (typeof name !== 'string' || !ToolCatalog.SERVER.test(name)) return [];
      const count = ToolCatalog.count(n);
      if (count === 0) return [];
      const failed = Math.min(ToolCatalog.count(failures), count);
      const said = failed > 0 && typeof error === 'string' ? ToolCatalog.errorOf(error) : null;
      return [{ name, calls: count, failures: failed, error: said }];
    });
  }

  /**
   * 승인한 목록(before)과 새로 받은 목록(after)의 차이 (C3, 2026-11-25). 둘 다 저장된 값이라 다시 거른다
   */
  static drift(before: unknown, after: unknown): ToolDrift {
    const was = new Map(ToolCatalog.of({ tools: before }).map((t) => [t.name, t.description]));
    const now = ToolCatalog.of({ tools: after });
    const names = new Set(now.map((t) => t.name));
    return {
      added: now.filter((t) => !was.has(t.name)),
      changed: now.flatMap((t) => {
        const old = was.get(t.name);
        return old === undefined || old === t.description
          ? []
          : [{ name: t.name, before: old, after: t.description }];
      }),
      removed: [...was.keys()].filter((name) => !names.has(name)),
    };
  }

  /**
   * 새 목록을 승인 없이 받아도 되는가: 처음 받은 목록(승인한 목록이 비었음)이거나 도구가 빠지기만 했다.
   * 새 도구 · 설명이 바뀐 도구가 있으면 관리자가 보고 승인해야 한다 (연결 뒤 설명을 바꿔 AI에게 다른 일을 시키는 공격)
   */
  static acceptable(before: unknown, after: unknown): boolean {
    if (ToolCatalog.of({ tools: before }).length === 0) return true;
    const drift = ToolCatalog.drift(before, after);
    return drift.added.length === 0 && drift.changed.length === 0;
  }

  /** 지시문에 싣는 줄: "search — 문서 찾기" */
  static jobLines(catalog: unknown): string[] {
    return ToolCatalog.of({ tools: catalog })
      .slice(0, ToolCatalog.JOB_LINES)
      .map((t) =>
        (t.description ? `${t.name} — ${t.description}` : t.name).slice(0, ToolCatalog.LINE_MAX),
      );
  }

  /** 저장할 실패 까닭: 첫 줄, 500자까지. 비면 기본 문구 */
  static errorOf(text: string | null): string {
    const line = ToolCatalog.oneLine(text ?? '').slice(0, ToolCatalog.ERROR_MAX);
    return line || '연결하지 못했어요';
  }

  private static oneLine(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  private static count(value: unknown): number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0
      ? Math.min(value, ToolCatalog.CALLS_MAX)
      : 0;
  }
}
