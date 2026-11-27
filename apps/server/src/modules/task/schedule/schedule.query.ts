import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery } from '../../platform';
import { schedules } from '../task.schema';
import type { ScheduleRow } from '../task.tables';
import { Schedule } from './schedule';
import type { ListSchedulesInput, ScheduleCalendarInput } from './schedule.input';
import { SchedulePolicy } from './schedule.policy';
import { type CalendarRunRow, ScheduleCalendarView, ScheduleListView } from './schedule.view';

// 스케줄 읽기. 주인만 (지시에 비공개 일이 적혀 있을 수 있다).
@Injectable()
export class ScheduleQuery extends BaseQuery {
  /** 캘린더: 스케줄 하나에서 펼치는 시각 · 지난 실행의 수 */
  private static readonly PER_SCHEDULE = 70;
  private static readonly RUNS_MAX = 1000;

  /** 공간의 스케줄 (만든 순서). agentId가 있으면 그 에이전트가 담당인 것만 */
  /** 켜진 스케줄 가운데 가장 이른 다음 시각. 없으면 null (ScheduleJob의 다음 마감) */
  async nextRun(actor: Actor): Promise<Date | null> {
    actor.assertOwnerOrSystem();
    const [row] = await this.sql<Pick<ScheduleRow, 'next_run_at'>[]>`
      SELECT min(next_run_at) AS next_run_at FROM task.schedules WHERE enabled`;
    return row?.next_run_at ?? null;
  }

  async list(actor: Actor, req: ListSchedulesInput): Promise<ScheduleListView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return new ScheduleListView(
      await this.rows(
        schedules,
        req.agentId === null ? { space_id: spaceId } : { space_id: spaceId, agent_id: req.agentId },
        { order: ['id'] },
      ),
    );
  }

  /**
   * 캘린더 (2026-11-27): 켜진 정한 시각 스케줄의 기간 안 시각과 기간 안에 만든 스케줄의 작업. 앞으로의 시각만 펼치고
   * (지난 시각은 runs가 보인다), 스케줄마다 PER_SCHEDULE개까지
   */
  async calendar(actor: Actor, req: ScheduleCalendarInput): Promise<ScheduleCalendarView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const now = new Date();
    const rows = await this.rows(schedules, {
      space_id: spaceId,
      enabled: true,
      trigger: Schedule.TIME,
    });
    const from = new Date(Math.max(req.from.getTime(), now.getTime()));
    const planned: { row: ScheduleRow; at: Date }[] = [];
    const repeating: ScheduleRow[] = [];
    for (const row of rows) {
      if (row.mode === Schedule.HOURLY || row.mode === Schedule.MINUTELY) {
        repeating.push(row);
        continue;
      }
      const next =
        row.mode === Schedule.ONCE
          ? (after: Date) => (row.run_at && row.run_at > after ? row.run_at : req.to)
          : (after: Date) =>
              SchedulePolicy.nextDaily(row.at_minute ?? 0, row.weekdays, row.time_zone, after);
      for (const at of SchedulePolicy.occurrences(next, from, req.to, ScheduleQuery.PER_SCHEDULE))
        planned.push({ row, at });
    }
    planned.sort((a, b) => a.at.getTime() - b.at.getTime());
    const runs = await this.sql<CalendarRunRow[]>`
      SELECT id AS task_id, title, status, created_at, payload->'chat'->>'chatId' AS chat_id,
             substring(coalesce(payload->'chat'->>'requestId', request_id) FROM 10 FOR 36) AS schedule_id
      FROM task.tasks
      WHERE space_id = ${spaceId} AND parent_id IS NULL
        AND created_at >= ${req.from} AND created_at < ${req.to}
        AND (request_id LIKE 'schedule:%' OR payload->'chat'->>'requestId' LIKE 'schedule:%')
      ORDER BY created_at LIMIT ${ScheduleQuery.RUNS_MAX}`;
    return new ScheduleCalendarView(planned, repeating, runs);
  }
}
