import { randomUUID } from 'node:crypto';
import { pause } from './backoff';
import type { BrowserPages, BrowserTab } from './browser-page';
import type { CairnServer } from './cairn-server';
import { LoginForm } from './login-form';
import type { LoginFormRef } from './login-form-ref';

/** 러너가 올릴 결재 하나 (작업 토큰으로, 에이전트의 이름으로) */
export type AskedApproval = {
  requestId: string;
  action: string;
  targetKind: string;
  targetId: string;
  targetVersion: number;
  note: string;
};

// 브라우저 일의 로그인 필요 (BrowseStage에서 뗌). 사람이 해야 하는 화면(로그인 · 가입 · 본인 인증 · 캡차)을 만나면
// 러너(AI 없음)가 그 화면을 남기고(browser_login_needed) 로그인 결재(browser.site.login, 대상 browser_site)를 준비한다.
// 등록 없이 (2026-11-19 사용자 결정): 둘러보기에서 만나면 서버가 그 주소의 출처로 사이트를 만들고, 관리자가 로그인할 탭을
// 로그인이 남는 서버 브라우저(유지 프로필)에 연다 (둘러보기의 창은 일이 끝나면 사라진다). "로그인했어요"면 같은 작업이
// 그 사이트의 일로 이어서 돈다 (코어가 결재의 대상을 작업의 대상으로)
export class BrowseLogin {
  static readonly ACTION = 'browser.site.login';
  /** 탭을 새로 열고 로그인 화면이 그려지기를 기다리는 시간 */
  private static readonly OPEN_MS = 2_000;

  constructor(
    private readonly server: CairnServer,
    private readonly pages: BrowserPages,
    private readonly taskId: string,
  ) {}

  /** 관리자가 로그인할 탭 (유지 프로필): 출처 안의 탭이 있으면 그것, 없으면 주소를 새 탭으로 열고 잠깐 기다린다 */
  async tab(url: string, origins: readonly string[], signal: AbortSignal): Promise<BrowserTab> {
    const tabs = await this.pages.tabs(signal);
    const open = tabs.find((t) => URL.canParse(t.url) && origins.includes(new URL(t.url).origin));
    if (open) return open;
    const made = await this.pages.open(url, signal);
    await pause(BrowseLogin.OPEN_MS, signal);
    return made;
  }

  /**
   * 로그인 화면을 남기고 로그인 결재를 만든다. 사이트가 없으면(둘러보기) 서버가 주소의 출처로 만든다.
   * reason: 로그인이 아닌 까닭 (가입 · 본인 인증 · 캡차 …). 카드가 메모 앞의 "확인 필요(까닭)"을 읽어 제목으로 쓴다.
   * form: AI가 알려 준 로그인 칸 (로그인 카드, 2026-11-19). 관리자가 로그인할 그 탭에서 다시 찾아 쓸 수 있을 때만 서버에 보낸다
   * (problem에 못 쓰는 까닭). 남기지 못하면 서버의 오류(ToolRefused · ServerUnreachable)를 그대로 던진다
   */
  async need(
    url: string,
    tab: BrowserTab | null,
    signal: AbortSignal,
    reason: string | null = null,
    form: LoginFormRef | null = null,
  ): Promise<{ approval: AskedApproval; siteName: string; card: boolean; problem: string | null }> {
    const image = tab ? await this.pages.shot(tab, signal) : null;
    const checked = await this.checked(url, tab, form, signal);
    const target = await this.server.logins.needed(this.taskId, {
      url,
      title: tab?.title ?? '',
      image,
      form: checked.form,
    });
    const name = target.siteName || (URL.canParse(url) ? new URL(url).host : url);
    return {
      siteName: name,
      card: target.card,
      problem: checked.problem,
      approval: {
        requestId: `browser-login:${randomUUID()}`,
        action: BrowseLogin.ACTION,
        targetKind: 'browser_site',
        targetId: target.siteId,
        targetVersion: target.siteVersion,
        note: reason
          ? `확인 필요(${reason}): ${name}. 화면에서 직접 한 뒤 "로그인했어요"를 눌러 주세요`
          : target.card
            ? `로그인 필요: ${name}. 카드의 칸에 넣어 로그인해 주세요 (화면에서 직접 해도 돼요)`
            : `로그인 필요: ${name}. 화면에서 로그인한 뒤 "로그인했어요"를 눌러 주세요`,
      },
    };
  }

  /** 로그인 칸을 그 탭에서 다시 찾는다. 넣어도 되는 출처(https)의 같은 화면에서 찾을 때만 쓴다 */
  private async checked(
    url: string,
    tab: BrowserTab | null,
    form: LoginFormRef | null,
    signal: AbortSignal,
  ): Promise<{ form: LoginFormRef | null; problem: string | null }> {
    if (!form || !tab) return { form: null, problem: null };
    if (!LoginForm.safeOrigin(url) || !URL.canParse(tab.url))
      return { form: null, problem: 'https 주소가 아니에요' };
    if (new URL(tab.url).origin !== new URL(url).origin)
      return { form: null, problem: '로그인 화면이 다른 주소로 열렸어요' };
    try {
      await LoginForm.check(tab, form, signal);
      return { form, problem: null };
    } catch (error) {
      return { form: null, problem: (error as Error).message };
    }
  }
}
