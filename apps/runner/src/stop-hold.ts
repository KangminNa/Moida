import type { AskedApproval } from './browse-login';
import { type BrowserPages, type BrowserTab, ButtonProblem, type HeldButton } from './browser-page';
import type { BrowserStop } from './browser-stop';
import { BrowserUnavailable, TabUnreadable } from './browser-tabs';
import type { CairnServer } from './cairn-server';
import { ServerUnreachable, ToolRefused } from './mcp-client';

/** 붙잡은 결과: 올릴 결재와 실행 기록 한 줄, 또는 실패로 끝낼 까닭 */
export type HoldOutcome = { approval: AskedApproval; line: string } | { error: string };

// AI가 멈춘 자리를 러너(AI 없음)가 붙잡아 결재를 준비한다 (BrowseStage에서 뗌, 2026-11-21). 결재는 AI가 아니라 러너가 올린다:
//   final_click → 그 탭에서 버튼을 다시 찾아 지문 · 화면과 함께 붙잡는다(browser_click_hold). 승인되면 ClickRunner가 누른다
//   click_plan → 누르기 계획(무엇을 · 몇 번)을 붙잡는다(browser_click_plan). 승인되면 같은 작업이 이어서 돌고 PressLoop가 누른다 (F2)
export class StopHold {
  /** 클릭 · 계획 결재의 동작 (이름은 1차 그대로: 에이전트의 결재 동작을 옮기지 않게) */
  static readonly PUBLISH_ACTION = 'browser.site.publish';

  constructor(
    private readonly server: CairnServer,
    private readonly pages: BrowserPages,
    private readonly taskId: string,
  ) {}

  async finalClick(
    tab: BrowserTab | null,
    stop: BrowserStop,
    signal: AbortSignal,
  ): Promise<HoldOutcome> {
    if (tab === null) return { error: '멈춘 페이지의 탭을 찾지 못했어요' };
    let held: HeldButton;
    try {
      const button = stop.button as NonNullable<BrowserStop['button']>;
      held = await this.pages.hold(tab, button, signal, stop.checks);
    } catch (error) {
      const known = [ButtonProblem, TabUnreadable, BrowserUnavailable].some(
        (t) => error instanceof t,
      );
      if (!known) throw error;
      return { error: `멈춘 버튼을 붙잡지 못했어요: ${(error as Error).message}` };
    }
    try {
      const click = await this.server.holdClick(this.taskId, held, stop.note);
      const host = URL.canParse(held.pageUrl) ? new URL(held.pageUrl).host : '';
      return {
        approval: {
          requestId: `browser-click:${click.clickId}`,
          action: StopHold.PUBLISH_ACTION,
          targetKind: 'browser_click',
          targetId: click.clickId,
          targetVersion: click.version,
          note: stop.note ?? `${held.button.role} "${held.button.name}" 앞에서 멈췄어요`,
        },
        line: `마지막 버튼 앞에서 멈췄어요: ${held.button.name} (${host})`,
      };
    } catch (error) {
      if (!(error instanceof ToolRefused || error instanceof ServerUnreachable)) throw error;
      return { error: `버튼을 붙잡지 못했어요: ${error.message}` };
    }
  }

  async plan(stop: BrowserStop): Promise<HoldOutcome> {
    const plan = stop.plan as NonNullable<BrowserStop['plan']>;
    try {
      const held = await this.server.presses.holdPlan(this.taskId, stop.pageUrl, plan);
      const note = `누르기 계획: ${plan.summary} (${plan.count}번)`;
      return {
        approval: {
          requestId: `browser-click-plan:${held.planId}`,
          action: StopHold.PUBLISH_ACTION,
          targetKind: 'browser_click_plan',
          targetId: held.planId,
          targetVersion: held.version,
          note,
        },
        line: note,
      };
    } catch (error) {
      if (!(error instanceof ToolRefused || error instanceof ServerUnreachable)) throw error;
      return { error: `누르기 계획을 붙잡지 못했어요: ${error.message}` };
    }
  }
}
