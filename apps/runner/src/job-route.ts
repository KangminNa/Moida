import type { Json } from './json';
import type { PromptPack } from './prompt-pack';

/**
 * 이 일의 방법 지정 (payload.route, C4 도구 우선순위 2026-11-27): 대표가 관리자의 말("공식 MCP만", "이번엔 커넥터 없이")을
 * delegate_task의 route로 남기면 서버가 하위 작업에 싣는다. mcp: 붙은 커넥터만 쓰고 다음 단계로 넘어가지 않는다,
 * web: 커넥터를 붙이지 않는다(Job이 tools를 비운다) → 사이트 도구 · read_url · 서버 브라우저 순서
 */
export class JobRoute {
  static readonly ROUTES = ['mcp', 'web'] as const;

  constructor(readonly route: (typeof JobRoute.ROUTES)[number]) {}

  static from(payload: Json): JobRoute | null {
    const route = payload.optionalText('route');
    return route === 'mcp' || route === 'web' ? new JobRoute(route) : null;
  }

  /** 커넥터를 붙이지 않는 일인가 (어댑터 · 지시문의 tools를 함께 비운다) */
  get skipsConnectors(): boolean {
    return this.route === 'web';
  }

  /** 지시문 단락 (틀 route) */
  part(prompts: PromptPack): string {
    return prompts.fill('route', { mcp: this.route === 'mcp', web: this.route === 'web' });
  }
}
