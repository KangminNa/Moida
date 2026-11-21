import { ButtonRef, type HeldButton, type PressResult } from './browser-page';
import type { McpClient } from './mcp-client';

/** browser_press_next로 가져간 누르기 하나: AI가 요청한 페이지 · 버튼 */
export class PressOrder {
  constructor(
    readonly id: string,
    readonly version: number,
    readonly pageUrl: string,
    readonly button: ButtonRef,
    readonly note: string | null,
  ) {}
}

/**
 * 누르기 계획의 러너 쪽 MCP 도구 (browser-tabs 0.9, F2 2026-11-21): 계획 붙잡기, AI가 요청한 누르기 가져가기 · 결과 남기기.
 * 모양의 원본은 plugins/browser-tabs/cairn-plugin.json의 tools다
 */
export class PressCalls {
  constructor(private readonly mcp: McpClient) {}

  /** AI가 남긴 계획을 붙잡는다. 계획 결재의 대상(계획과 판)을 돌려준다 */
  async holdPlan(
    taskId: string,
    pageUrl: string,
    plan: { summary: string; count: number },
  ): Promise<{ planId: string; version: number }> {
    const body = await this.mcp.call('browser_click_plan', {
      task_id: taskId,
      page_url: pageUrl,
      summary: plan.summary,
      count: plan.count,
    });
    return { planId: body.text('plan_id'), version: body.number('version') };
  }

  /** 이 일에서 AI가 요청한 누르기 하나 (없으면 null) */
  async nextPress(taskId: string, stop: AbortSignal): Promise<PressOrder | null> {
    const body = await this.mcp.call('browser_press_next', { task_id: taskId }, 0, stop);
    if (!body.field('click')) return null;
    const c = body.child('click');
    return new PressOrder(
      c.text('id'),
      c.number('version'),
      c.text('page_url'),
      new ButtonRef(c.text('role'), c.text('name'), c.number('nth')),
      c.optionalText('note'),
    );
  }

  /** 누른 결과(clicked: 다시 찾은 버튼과 누르기 전 · 뒤 화면) 또는 누르지 않은 까닭(changed) */
  async savePress(
    taskId: string,
    order: PressOrder,
    result: PressResult,
    held: HeldButton | null,
  ): Promise<void> {
    await this.mcp.call('browser_press_save', {
      task_id: taskId,
      click_id: order.id,
      version: order.version,
      outcome: result.outcome,
      ...(result.reason ? { reason: result.reason.slice(0, 500) } : {}),
      ...(result.afterUrl && /^https?:\/\//i.test(result.afterUrl)
        ? { after_url: result.afterUrl.slice(0, 2000) }
        : {}),
      ...(held
        ? {
            tab_id: held.tab.id,
            box: held.box,
            fingerprint: held.fingerprint,
            before_image: held.image,
          }
        : {}),
      ...(result.image ? { after_image: result.image } : {}),
    });
  }
}
