import type { Json } from './json';

/**
 * 외부 도구 하나 (2차 7단계): 에이전트에게 허락한 바깥 서비스의 원격 MCP 서버. 서버가 일과 함께 보낸다 (next_jobs의 tools).
 * 러너 안의 서버 이름은 x-<name>이라 moida · playwright와 겹치지 않는다. 머리글 값(토큰)은 로그와 기록에서 지울 값이다.
 * 서버가 거른 값이지만 CLI 설정에 그대로 쓰므로 모양을 다시 본다: 틀린 도구는 붙이지 않는다.
 */
export class ExternalMcp {
  static readonly PREFIX = 'x-';
  private static readonly NAME = /^[a-z][a-z0-9-]{1,29}$/;
  private static readonly HEADER = /^[A-Za-z0-9-]{1,40}$/;
  /** 지시문에 싣는 도구 줄 (서버 ToolCatalog.JOB_LINES · LINE_MAX와 같다) */
  private static readonly CATALOG_LINES = 30;
  private static readonly LINE_MAX = 120;

  private constructor(
    readonly name: string,
    readonly url: string,
    readonly headers: Readonly<Record<string, string>>,
    /** 연결 확인으로 받은 도구 줄 ("search — 문서 찾기"). 확인 전이면 비어 있다 (2026-11-15 MCP 1단계) */
    readonly catalog: readonly string[] = [],
  ) {}

  /** next_jobs의 tools. 모양이 틀린 것은 뺀다 */
  static list(raw: readonly Json[]): readonly ExternalMcp[] {
    return raw.flatMap((tool) => {
      const name = tool.text('name');
      const url = tool.text('url');
      const headers = ExternalMcp.headersOf(tool.field('headers'));
      if (!ExternalMcp.NAME.test(name) || !ExternalMcp.https(url) || headers === null) return [];
      const catalog = tool
        .texts('catalog')
        .map((line) => line.replace(/\s+/g, ' ').trim().slice(0, ExternalMcp.LINE_MAX))
        .filter((line) => line !== '')
        .slice(0, ExternalMcp.CATALOG_LINES);
      return [new ExternalMcp(name, url, headers, catalog)];
    });
  }

  /** CLI 설정의 MCP 서버 이름 */
  get server(): string {
    return `${ExternalMcp.PREFIX}${this.name}`;
  }

  /** 지시문의 한 덩이: 서버 이름과 도구 줄 */
  get promptLines(): string {
    if (this.catalog.length === 0) return `- ${this.server} (도구 목록은 MCP로 받습니다)`;
    return [`- ${this.server}`, ...this.catalog.map((line) => `  - ${line}`)].join('\n');
  }

  /** 로그와 기록에서 지울 값 */
  get secrets(): readonly string[] {
    return Object.values(this.headers);
  }

  private static https(url: string): boolean {
    try {
      return new URL(url).protocol === 'https:';
    } catch {
      return false;
    }
  }

  /** 머리글: 이름은 글자 · 숫자 · -, 값은 한 줄. 하나라도 틀리면 null */
  private static headersOf(raw: unknown): Readonly<Record<string, string>> | null {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== 'object' || Array.isArray(raw)) return null;
    const entries = Object.entries(raw as Record<string, unknown>);
    const fine = entries.every(
      ([key, value]) =>
        ExternalMcp.HEADER.test(key) && typeof value === 'string' && !/[\r\n]/.test(value),
    );
    return fine ? Object.fromEntries(entries as [string, string][]) : null;
  }
}
