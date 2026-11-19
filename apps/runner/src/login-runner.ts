import { Backoff, pause } from './backoff';
import type { BrowserPages, BrowserTab } from './browser-page';
import type { BrowserSlot } from './browser-slot';
import { BrowserUnavailable } from './browser-tabs';
import type { LoginCalls, LoginOutcome, QueuedLogin } from './login-calls';
import { LoginForm, LoginFormProblemOnPage } from './login-form';
import { AccessDenied, ServerUnreachable, ToolRefused } from './mcp-client';
import type { RunLog } from './redactor';

// 로그인 카드의 러너 쪽 (2026-11-19 사용자 결정, 원칙 8을 바꿈). 서버 브라우저가 있는 서버 러너만, AI 없이 돈다.
// 관리자가 대화의 로그인 카드 칸에 넣은 값을 browser_login_next로 꺼내(서버 메모리에서 지워진다) 로그인 화면의 칸에 넣고
// 로그인 단추를 누른 뒤, 그 뒤 화면을 browser_login_save로 남긴다. 카드가 그것을 보고 같은 작업을 잇는다.
// 값은 로그 · 화면 기록 · 실행 기록 어디에도 쓰지 않는다 (로그에는 사이트 id와 호스트만). 넣기 전에 탭의 출처가 그 로그인 화면의
// 출처(https)인지 다시 보고, 칸이 하나뿐이고 종류가 맞을 때만 넣는다 (LoginForm). 다르면 넣지 않고 까닭을 남긴다.
// 브라우저 자리(BrowserSlot)는 사이트 일 · 결재된 클릭과 나눠 쓴다
export class LoginRunner {
  /** 넣을 것이 없을 때 다시 묻는 간격 (관리자가 카드에서 기다린다) */
  static readonly IDLE_MS = 3_000;
  /** 패키지가 꺼져 있거나 옛 서버일 때 (도구가 없을 때) 다시 묻는 간격 */
  static readonly OFF_MS = 300_000;
  /** 로그인 화면을 새 탭으로 열고 그려지기를 기다리는 시간 */
  private static readonly OPEN_MS = 2_000;
  private static readonly SAVE_TRIES = 5;
  private readonly backoff = new Backoff(3_000, 300_000);
  private off = false;

  constructor(
    private readonly logins: LoginCalls,
    private readonly pages: BrowserPages,
    private readonly slot: BrowserSlot,
    private readonly log: RunLog,
  ) {}

  /** stop까지 돈다. 토큰이 거절되면 AccessDenied를 그대로 던진다 (러너가 다시 연결한다) */
  async run(stop: AbortSignal): Promise<void> {
    while (!stop.aborted) {
      try {
        const login = await this.logins.next(stop);
        this.off = false;
        this.backoff.reset();
        if (login) await this.signIn(login, stop);
        else await pause(LoginRunner.IDLE_MS, stop);
      } catch (error) {
        if (stop.aborted) break;
        if (error instanceof AccessDenied) throw error;
        if (error instanceof ToolRefused && /도구가 없어요/.test(error.message)) {
          if (!this.off)
            this.log.info('로그인 카드를 받지 않아요 (브라우저 탭 패키지가 꺼져 있거나 옛 버전)');
          this.off = true;
          await pause(LoginRunner.OFF_MS, stop);
          continue;
        }
        this.log.info(`로그인 카드: 다시 시도해요: ${(error as Error).message}`);
        await this.backoff.wait(stop);
      }
    }
  }

  /** 자리를 잡고 칸에 넣고 누른 뒤 결과를 남긴다 */
  private async signIn(login: QueuedLogin, stop: AbortSignal): Promise<void> {
    const host = URL.canParse(login.pageUrl) ? new URL(login.pageUrl).host : '';
    let result: LoginOutcome;
    const free = await this.slot.take(stop);
    if (free === null) return;
    try {
      result = await this.fill(login, stop);
    } finally {
      free();
      login.values.clear();
    }
    this.log.info(
      result.outcome === 'submitted'
        ? `로그인 카드의 값을 넣고 눌렀어요: ${login.siteId} (${host})`
        : `로그인 카드의 값을 넣지 않았어요: ${login.siteId} (${host}) — ${result.reason}`,
    );
    for (let tries = 1; ; tries++) {
      try {
        await this.logins.save(login.siteId, result);
        return;
      } catch (error) {
        if (
          !(error instanceof ServerUnreachable) ||
          tries >= LoginRunner.SAVE_TRIES ||
          stop.aborted
        )
          throw error;
        await this.backoff.wait(stop);
      }
    }
  }

  private async fill(login: QueuedLogin, stop: AbortSignal): Promise<LoginOutcome> {
    const failed = (reason: string): LoginOutcome => ({
      outcome: 'failed',
      reason,
      afterUrl: null,
      image: null,
    });
    if (!LoginForm.safeOrigin(login.pageUrl)) return failed('https 주소가 아니라 넣지 않았어요');
    const origin = new URL(login.pageUrl).origin;
    try {
      const tab = await this.tabOf(login.pageUrl, origin, stop);
      await LoginForm.check(tab, login.form, stop);
      const afterUrl = await LoginForm.submit(tab, origin, login.form, login.values, stop);
      const image = await this.pages.shot(tab, stop).catch(() => null);
      return { outcome: 'submitted', reason: null, afterUrl, image };
    } catch (error) {
      if (error instanceof LoginFormProblemOnPage || error instanceof BrowserUnavailable)
        return failed(error.message);
      throw error;
    }
  }

  /** 로그인 화면의 탭: 같은 출처의 탭이 있으면 그것(관리자가 보던 로그인 화면), 없으면 그 주소를 새 탭으로 연다 */
  private async tabOf(url: string, origin: string, stop: AbortSignal): Promise<BrowserTab> {
    const tabs = await this.pages.tabs(stop);
    const same = (t: BrowserTab) => URL.canParse(t.url) && new URL(t.url).origin === origin;
    const exact = tabs.find((t) => t.url === url) ?? tabs.find(same);
    if (exact) return exact;
    const made = await this.pages.open(url, stop);
    await pause(LoginRunner.OPEN_MS, stop);
    return made;
  }
}
