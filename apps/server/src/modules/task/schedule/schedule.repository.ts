import { TableRepository } from '../../platform';
import { schedules } from '../task.schema';
import type { ScheduleRow } from '../task.tables';
import { Schedule } from './schedule';

// task.schedules ↔ Schedule. 저장은 기반이 하고(바뀐 칸만, version으로 늦은 쓰기를 막는다), 여기에는 찾는 SQL만 있다.
export class ScheduleRepository extends TableRepository<ScheduleRow, Schedule> {
  protected readonly table = schedules;
  protected readonly noun = '스케줄';
  protected override readonly dueWake = [Schedule.DUE_JOB, ['next_run_at', 'enabled']] as const;

  protected toEntity(row: ScheduleRow): Schedule {
    return Schedule.restore(row);
  }

  /** 켜져 있고 때가 된 스케줄을 때 순서로 잠근다 (모든 공간). 다른 일꾼이 잡은 줄은 건너뛴다 */
  async lockDue(now: Date, limit: number): Promise<readonly Schedule[]> {
    // 칸 자체를 조건으로: 조건 규칙의 enabled = $1은 일반 계획에서 부분 색인 schedules_due_idx(WHERE enabled)를 못 쓴다
    const rows = await this.sql<ScheduleRow[]>`
      SELECT * FROM task.schedules WHERE enabled AND next_run_at <= ${now}
      ORDER BY next_run_at LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
    return rows.map((r) => this.toEntity(r));
  }

  /** 앞 레시피(afterId)의 일이 끝나면 도는 레시피를 잠근다 (계기 after, 만든 순서) */
  async lockAfter(spaceId: string, afterId: string): Promise<readonly Schedule[]> {
    const rows = await this.sql<ScheduleRow[]>`
      SELECT * FROM task.schedules WHERE space_id = ${spaceId} AND after_id = ${afterId}
      ORDER BY created_at, id FOR UPDATE`;
    return rows.map((r) => this.toEntity(r));
  }

  /** id에서 앞 레시피를 거슬러 올라간 id들 (자기 포함). 고리가 생기지 않게 볼 때 */
  async chainOf(spaceId: string, id: string): Promise<readonly string[]> {
    const rows = await this.sql<{ id: string }[]>`
      WITH RECURSIVE chain (id, after_id) AS (
        SELECT id, after_id FROM task.schedules WHERE space_id = ${spaceId} AND id = ${id}
        UNION
        SELECT s.id, s.after_id FROM task.schedules s JOIN chain c ON s.id = c.after_id
        WHERE s.space_id = ${spaceId}
      )
      SELECT id FROM chain`;
    return rows.map((r) => r.id);
  }

  /** 지운다 (설정이라 판을 남기지 않는다. 이미 만든 작업은 그대로) */
  /** 이 대화로 보내는 자동화가 있는가 (대화를 휴지통으로 보내기 전에, 2026-11-19 휴지통 A) */
  async boundToChat(spaceId: string, chatId: string): Promise<boolean> {
    const rows = await this.sql`
      SELECT 1 FROM task.schedules WHERE space_id = ${spaceId} AND chat_id = ${chatId} LIMIT 1`;
    return rows.length > 0;
  }

  async remove(schedule: Schedule): Promise<void> {
    await this.deleteRows(schedules, { space_id: schedule.spaceId, id: schedule.id });
  }

  /** 켜져 있는 레시피 하나를 잠근다. 없거나 꺼졌으면 null (자동화 건강 검사) */
  async lockEnabled(spaceId: string, id: string): Promise<Schedule | null> {
    const [row] = await this.sql<ScheduleRow[]>`
      SELECT * FROM task.schedules WHERE space_id = ${spaceId} AND id = ${id} AND enabled FOR UPDATE`;
    return row ? this.toEntity(row) : null;
  }

  /** 작업을 만든 레시피의 request_id (대화의 회차면 payload.chat.requestId). 상태와 상관없이 (자동화 건강 검사) */
  async requestOf(spaceId: string, taskId: string): Promise<string | null> {
    const [row] = await this.sql<{ request: string | null }[]>`
      SELECT COALESCE(payload->'chat'->>'requestId', request_id) AS request FROM task.tasks
      WHERE space_id = ${spaceId} AND id = ${taskId}`;
    return row?.request ?? null;
  }

  /** 이 레시피가 만든 맨 위 작업 가운데 끝난(완료 · 실패 · 취소) 최근 limit개의 상태 (최근 것부터) */
  async recentRuns(spaceId: string, prefix: string, limit: number): Promise<readonly string[]> {
    const rows = await this.sql<{ status: string }[]>`
      SELECT status FROM task.tasks
      WHERE space_id = ${spaceId} AND parent_id IS NULL
        AND COALESCE(payload->'chat'->>'requestId', request_id) LIKE ${`${prefix}%`}
        AND status IN ('done', 'failed', 'cancelled')
      ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
    return rows.map((r) => r.status);
  }
}
