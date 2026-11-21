import type { ClickPlanRow, ClickRow } from './tables';

// 누르기 계획과 계획 안의 누르기가 내보내는 모양 (F2, 2026-11-21). 러너 · 에이전트(MCP)라 snake_case.

/** browser_click_plan의 답: 결재(browser.site.publish)의 대상 browser_click_plan · id · 판 */
export class PlanHeldView {
  constructor(private readonly row: Readonly<ClickPlanRow>) {}

  toJSON() {
    return { plan_id: this.row.id, version: this.row.version };
  }
}

/** browser_job의 click_plan: 승인된 계획 (AI에게 무엇을 · 몇 번 남았는지) */
export class PlanPartView {
  constructor(private readonly row: Readonly<ClickPlanRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      summary: r.summary,
      max_clicks: r.max_clicks,
      used: r.used,
      left: Math.max(0, r.max_clicks - r.used),
    };
  }
}

/** browser_press · browser_press_result · browser_press_save의 답: 누르기 하나와 계획의 남은 횟수 */
export class PressView {
  constructor(
    private readonly row: Readonly<ClickRow>,
    private readonly plan: Readonly<ClickPlanRow> | null,
  ) {}

  toJSON() {
    const r = this.row;
    const plan = this.plan;
    return {
      click_id: r.id,
      status: r.status,
      reason: r.reason,
      after_url: r.after_url,
      left: plan ? Math.max(0, plan.max_clicks - plan.used) : 0,
    };
  }
}

/** browser_press_next의 답: 러너가 누를 누르기 하나 (없으면 null) */
export class NextPressView {
  constructor(private readonly row: Readonly<ClickRow> | null) {}

  toJSON() {
    const r = this.row;
    return {
      click: r
        ? {
            id: r.id,
            version: r.version,
            task_id: r.task_id,
            page_url: r.page_url,
            role: r.role,
            name: r.name,
            nth: r.nth,
            note: r.note,
          }
        : null,
    };
  }
}
