import type { ScheduleRow, TaskRow } from '../task.tables';

// 스케줄의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장). 주인만 본다.

/** 스케줄 하나. 시각은 API에서 atTime("09:30"), 칸은 at_minute(570) */
export class ScheduleView {
  constructor(private readonly row: Readonly<ScheduleRow>) {}

  toJSON() {
    const r = this.row;
    const at = r.at_minute;
    return {
      id: r.id,
      title: r.title,
      agentId: r.agent_id,
      enabled: r.enabled,
      mode: r.mode,
      atTime:
        at === null
          ? null
          : `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`,
      weekdays: r.weekdays,
      everyHours: r.every_hours,
      /** N분마다의 간격 (2026-11-20). 다른 주기면 null */
      everyMinutes: r.every_minutes,
      runAt: r.run_at?.toISOString() ?? null,
      timeZone: r.time_zone,
      instruction: r.instruction,
      goalId: r.goal_id,
      /** 새 판을 만들 페이지 (자라는 페이지). 없으면 null */
      pageId: r.page_id,
      /** 레시피 (2차 5단계): 어디로(task · chat · page) · 받을 것 · 지킬 것 · 계기(time · manual · after)와 앞 레시피 */
      destination: r.destination,
      deliver: r.deliver,
      /** 회차의 답 · 실패를 관리자 메일로도 보낸다 (2026-11-27, 대화로 보낼 때만, 메일 플러그인이 보낸다) */
      mail: r.mail,
      rules: r.rules,
      trigger: r.trigger,
      afterId: r.after_id,
      /** 대화로 보내는 레시피가 회차를 쌓는 대화 (처음 돌 때 연다) */
      chatId: r.chat_id,
      dailyMax: r.daily_max,
      /** 이 날(시간대 기준)에 만든 작업 수. 화면이 오늘인지 견준다 */
      runDay: r.run_day,
      dayRuns: r.day_runs,
      nextRunAt: r.next_run_at?.toISOString() ?? null,
      lastRunAt: r.last_run_at?.toISOString() ?? null,
      version: r.version,
      createdAt: r.created_at.toISOString(),
    };
  }
}

/** 스케줄 목록. 몇 개뿐이라 한 쪽에 다 보낸다 */
export class ScheduleListView {
  constructor(private readonly rows: readonly Readonly<ScheduleRow>[]) {}

  toJSON() {
    return { schedules: this.rows.map((r) => new ScheduleView(r).toJSON()) };
  }
}

/** 캘린더의 지난 실행 하나: 스케줄이 만든 작업 (대화로 보낸 것은 그 회차) */
export type CalendarRunRow = Pick<TaskRow, 'title' | 'status' | 'created_at'> & {
  task_id: string;
  schedule_id: string;
  chat_id: string | null;
};

/**
 * 캘린더 (2026-11-27, GET api/schedules/calendar): 기간 안에 돌 시각(planned: 매일 · 한 번은 시각마다 펼친다),
 * 펼치지 않는 짧은 주기(repeating: N시간 · N분마다), 지난 실행(runs: 만든 작업의 상태). 날짜로 묶는 것은 화면이 (보는 사람의 시간대)
 */
export class ScheduleCalendarView {
  constructor(
    private readonly planned: readonly { row: Readonly<ScheduleRow>; at: Date }[],
    private readonly repeating: readonly Readonly<ScheduleRow>[],
    private readonly runs: readonly CalendarRunRow[],
  ) {}

  toJSON() {
    return {
      planned: this.planned.map(({ row, at }) => ({
        scheduleId: row.id,
        title: row.title,
        mode: row.mode,
        destination: row.destination,
        at: at.toISOString(),
      })),
      repeating: this.repeating.map((r) => ({
        scheduleId: r.id,
        title: r.title,
        mode: r.mode,
        everyHours: r.every_hours,
        everyMinutes: r.every_minutes,
      })),
      runs: this.runs.map((r) => ({
        taskId: r.task_id,
        scheduleId: r.schedule_id,
        title: r.title,
        status: r.status,
        chatId: r.chat_id,
        at: r.created_at.toISOString(),
      })),
    };
  }
}
