import { LoginFormRef, SocialLoginRef } from './login-form-ref';
import type { McpClient } from './mcp-client';
import type { ProviderForm } from './provider-login';

/**
 * 관리자가 로그인 카드에서 한 것 하나 (browser_login_next). 값은 그 화면의 칸에만 넣고 어디에도 남기지 않는다.
 *   values: 사이트의 칸에 넣고 로그인 단추 누르기 · social: 간편 로그인 단추 누르기 (2026-11-26) ·
 *   provider: 간편 로그인 회사(고정 목록)의 화면 칸에 넣고 누르기 (pageUrl은 그 회사의 로그인 화면)
 */
export type QueuedLogin = {
  kind: 'values' | 'social' | 'provider';
  siteId: string;
  siteName: string;
  pageUrl: string;
  form: LoginFormRef | null;
  social: SocialLoginRef | null;
  /** 사이트의 허용 출처 (간편 로그인 창이 닫힌 뒤 사이트 탭을 찾을 때) */
  siteOrigins: string[];
  /** 칸 종류 → 값 */
  values: Map<string, string>;
};

/** 넣고 누른 결과 (browser_login_save). opened: 간편 로그인 단추를 눌러 그 회사의 화면이 열림 (칸을 찾았으면 providerForm) */
export type LoginOutcome = {
  outcome: 'submitted' | 'opened' | 'failed';
  reason: string | null;
  afterUrl: string | null;
  image: string | null;
  providerForm?: ProviderForm | null;
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
    const kind = login.text('kind') || 'values';
    const base = {
      siteId: login.text('site_id'),
      siteName: login.text('site_name'),
      pageUrl: login.text('page_url'),
      siteOrigins: [...login.texts('origins')],
      values: new Map<string, string>(),
    };
    if (kind === 'social') {
      const s = login.child('social');
      const social = new SocialLoginRef(s.text('provider'), s.text('role'), s.text('name'));
      return { ...base, kind: 'social', form: null, social };
    }
    const fields = login.list('fields').map((f) => {
      base.values.set(f.text('kind'), f.text('value'));
      return { kind: f.text('kind'), role: f.text('role'), name: f.text('name') };
    });
    const submit = login.child('submit');
    const form = LoginFormRef.parse({
      fields,
      submit: { role: submit.text('role'), name: submit.text('name') },
    });
    return { ...base, kind: kind === 'provider' ? 'provider' : 'values', form, social: null };
  }

  async save(siteId: string, result: LoginOutcome): Promise<void> {
    await this.mcp.call('browser_login_save', {
      site_id: siteId,
      outcome: result.outcome,
      ...(result.reason ? { reason: result.reason.slice(0, 300) } : {}),
      ...(result.afterUrl ? { after_url: result.afterUrl.slice(0, 2000) } : {}),
      ...(result.image ? { image: result.image } : {}),
      ...(result.providerForm
        ? {
            provider_form: {
              provider: result.providerForm.provider,
              page_url: result.providerForm.pageUrl.slice(0, 2000),
              ...result.providerForm.form.toJSON(),
            },
          }
        : {}),
    });
  }
}
