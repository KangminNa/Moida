import { LoginFormRef } from './login-form-ref';
import type { McpClient } from './mcp-client';

/** 관리자가 로그인 카드에 넣은 로그인 하나 (browser_login_next). 값은 그 사이트의 칸에만 넣고 어디에도 남기지 않는다 */
export type QueuedLogin = {
  siteId: string;
  siteName: string;
  pageUrl: string;
  form: LoginFormRef;
  /** 칸 종류 → 값 */
  values: Map<string, string>;
};

/** 넣고 누른 결과 (browser_login_save) */
export type LoginOutcome = {
  outcome: 'submitted' | 'failed';
  reason: string | null;
  afterUrl: string | null;
  image: string | null;
};

/**
 * 로그인의 러너 쪽 MCP 도구 (browser-tabs 0.7, 2026-11-19 로그인 카드): 로그인 필요 남기기(칸과 함께),
 * 카드에 넣은 값 꺼내기 · 결과 남기기. 모양의 원본은 plugins/browser-tabs/cairn-plugin.json의 tools다
 */
export class LoginCalls {
  constructor(private readonly mcp: McpClient) {}

  /** 로그인 화면을 남긴다. 결재의 대상(사이트와 판)과 카드에 칸이 떴는지를 돌려준다 */
  async needed(
    taskId: string,
    page: { url: string; title: string; image: string | null; form: LoginFormRef | null },
  ): Promise<{ siteId: string; siteVersion: number; siteName: string; card: boolean }> {
    const body = await this.mcp.call('browser_login_needed', {
      task_id: taskId,
      page_url: page.url,
      page_title: page.title,
      ...(page.image ? { image: page.image } : {}),
      ...(page.form ? { form: page.form.toJSON() } : {}),
    });
    return {
      siteId: body.text('site_id'),
      siteVersion: body.number('site_version'),
      // 등록 없이 만든 사이트의 이름 (2026-11-19). 옛 서버면 빈 글
      siteName: body.text('site_name'),
      card: body.flag('login_card'),
    };
  }

  async next(stop: AbortSignal): Promise<QueuedLogin | null> {
    const body = await this.mcp.call('browser_login_next', {}, 0, stop);
    if (!body.field('login')) return null;
    const login = body.child('login');
    const values = new Map<string, string>();
    const fields = login.list('fields').map((f) => {
      values.set(f.text('kind'), f.text('value'));
      return { kind: f.text('kind'), role: f.text('role'), name: f.text('name') };
    });
    const submit = login.child('submit');
    const form = LoginFormRef.parse({
      fields,
      submit: { role: submit.text('role'), name: submit.text('name') },
    }) as LoginFormRef;
    return {
      siteId: login.text('site_id'),
      siteName: login.text('site_name'),
      pageUrl: login.text('page_url'),
      form,
      values,
    };
  }

  async save(siteId: string, result: LoginOutcome): Promise<void> {
    await this.mcp.call('browser_login_save', {
      site_id: siteId,
      outcome: result.outcome,
      ...(result.reason ? { reason: result.reason.slice(0, 300) } : {}),
      ...(result.afterUrl ? { after_url: result.afterUrl.slice(0, 2000) } : {}),
      ...(result.image ? { image: result.image } : {}),
    });
  }
}
