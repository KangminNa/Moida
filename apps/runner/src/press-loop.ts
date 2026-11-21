import { pause } from './backoff';
import {
  BrowserPages,
  type BrowserTab,
  ButtonProblem,
  type HeldButton,
  PressResult,
} from './browser-page';
import { BrowserUnavailable, TabUnreadable } from './browser-tabs';
import { ServerUnreachable, ToolRefused } from './mcp-client';
import type { PressCalls, PressOrder } from './press-calls';
import { RunEvent } from './progress';

type Note = (event: RunEvent) => void;

// 일 하나에 승인 한 번 (F2, 2026-11-21)의 러너 쪽.
// 계획을 붙잡는 것은 StopHold.plan이다. 계획이 승인된 실행(browser_job의 click_plan)에서는 AI가 도는 동안 이 고리가 함께 돈다. AI가 browser_press로
//   요청한 누르기를 가져가(browser_press_next) 그 페이지의 탭에서 역할 + 이름으로 버튼을 다시 찾아(BrowserPages.hold:
//   보임 · 켜짐 · 가장 위) 같은 버튼일 때만 실제 마우스로 누르고(press) 결과를 남긴다(browser_press_save). AI는 직접 누르지 않는다.
//   사이트 일의 브라우저 자리는 BrowseStage가 이미 잡고 있다. 로그에는 클릭 id와 호스트만
export class PressLoop {
  /** 요청이 없을 때 다시 묻는 간격 (AI가 결과를 기다리고 있다) */
  static readonly IDLE_MS = 1_500;
  private static readonly RETRY_MS = 5_000;
  private readonly halt = new AbortController();
  private running: Promise<void> | null = null;

  constructor(
    private readonly calls: PressCalls,
    private readonly pages: BrowserPages,
    private readonly taskId: string,
    private readonly tabOf: (url: string, signal: AbortSignal) => Promise<BrowserTab | null>,
    private readonly note: Note,
  ) {}

  start(signal: AbortSignal): void {
    this.running = this.loop(AbortSignal.any([signal, this.halt.signal]));
  }

  /** 고리를 멈추고 하던 누르기가 끝나기를 기다린다 */
  async stop(): Promise<void> {
    this.halt.abort();
    await this.running;
    this.running = null;
  }

  private async loop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const order = await this.calls.nextPress(this.taskId, signal);
        if (order) await this.press(order, signal);
        else await pause(PressLoop.IDLE_MS, signal);
      } catch (error) {
        if (signal.aborted) break;
        if (!(error instanceof ToolRefused || error instanceof ServerUnreachable)) {
          this.note(
            new RunEvent(RunEvent.ERROR, `누르기 고리가 멈췄어요: ${(error as Error).message}`, 0),
          );
          break;
        }
        await pause(PressLoop.RETRY_MS, signal);
      }
    }
  }

  /** 다시 찾아 같은 버튼일 때만 누른다. 찾지 못하거나 주소가 바뀌었으면 누르지 않고 까닭을 남긴다 */
  private async press(order: PressOrder, signal: AbortSignal): Promise<void> {
    const changed = (reason: string) => new PressResult('changed', reason, null, null);
    const host = URL.canParse(order.pageUrl) ? new URL(order.pageUrl).host : '';
    let held: HeldButton | null = null;
    let result: PressResult;
    const tab = await this.tabOf(order.pageUrl, signal);
    if (tab === null) result = changed('그 주소의 탭을 찾지 못했어요');
    else {
      try {
        held = await this.pages.hold(tab, order.button, signal);
        result =
          BrowserPages.withoutHash(held.pageUrl) === BrowserPages.withoutHash(order.pageUrl)
            ? await this.pages.press(
                {
                  tabId: held.tab.id,
                  pageUrl: held.pageUrl,
                  button: order.button,
                  fingerprint: held.fingerprint,
                },
                signal,
              )
            : changed('요청한 뒤 주소가 바뀌었어요');
      } catch (error) {
        const known = [ButtonProblem, TabUnreadable, BrowserUnavailable].some(
          (t) => error instanceof t,
        );
        if (!known) throw error;
        result = changed((error as Error).message);
      }
    }
    await this.calls.savePress(this.taskId, order, result, held);
    const what = order.note ?? `${order.button.role} "${order.button.name}"`;
    this.note(
      new RunEvent(
        RunEvent.WRITE,
        result.outcome === 'clicked'
          ? `눌렀어요: ${what} (${host})`
          : `누르지 않았어요: ${what} (${host}) — ${result.reason ?? ''}`,
        0,
      ),
    );
  }
}
