import type { AgentRow, ScheduleRow } from '../task.tables';

// 설정 바꾸기 (2026-11-15 C)의 읽기 모양: MCP get_settings와 제안의 지금 값. MCP라 snake_case이고,
// 칸 이름은 propose_setting의 fields와 같다 (관리자 REST의 칸을 snake_case로). 토큰 같은 비밀은 설정에 없다.

/** 에이전트 한 줄 (지운 에이전트는 없다). model · effort가 빈 글이면 CLI의 기본 */
export class AgentSettingView {
  constructor(private readonly row: Readonly<AgentRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      version: r.version,
      status: r.status,
      name: r.name,
      role: r.role,
      tool: r.tool,
      model: r.model,
      effort: r.effort,
      approval_actions: r.approval_actions,
      reviewer_id: r.reviewer_id,
      runner_id: r.runner_id,
      external_tools: r.external_tools,
      monthly_limit: r.monthly_limit,
      five_hour_limit: r.five_hour_limit,
      plan_stop_percent: r.plan_stop_percent,
    };
  }
}

/** 스케줄(레시피) 한 줄. 시각은 "09:30" (매일일 때만) */
export class ScheduleSettingView {
  constructor(private readonly row: Readonly<ScheduleRow>) {}

  toJSON() {
    const r = this.row;
    const at = r.at_minute;
    return {
      id: r.id,
      version: r.version,
      title: r.title,
      agent_id: r.agent_id,
      enabled: r.enabled,
      mode: r.mode,
      at_time:
        at === null
          ? null
          : `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`,
      weekdays: r.weekdays,
      every_hours: r.every_hours,
      every_minutes: r.every_minutes,
      time_zone: r.time_zone,
      instruction: r.instruction,
      goal_id: r.goal_id,
      page_id: r.page_id,
      destination: r.destination,
      deliver: r.deliver,
      rules: r.rules,
      trigger: r.trigger,
      after_id: r.after_id,
      daily_max: r.daily_max,
      next_run_at: r.next_run_at?.toISOString() ?? null,
      // 회차가 쌓이는 대화 (O-3: 대표는 이 대화의 자동화를 찾아 멈추거나 바꾼다)
      chat_id: r.chat_id,
    };
  }
}

/** get_settings { kind: team } */
export class TeamSettingsView {
  constructor(private readonly rows: readonly AgentRow[]) {}

  toJSON() {
    return { agents: this.rows.map((r) => new AgentSettingView(r).toJSON()) };
  }
}

/** get_settings { kind: schedules } */
export class ScheduleSettingsView {
  constructor(private readonly rows: readonly ScheduleRow[]) {}

  toJSON() {
    return { schedules: this.rows.map((r) => new ScheduleSettingView(r).toJSON()) };
  }
}
