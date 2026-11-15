import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery } from '../../platform';
import { schedules } from '../task.schema';
import type { ScheduleRow } from '../task.tables';
import type { ListSchedulesInput } from './schedule.input';
import { ScheduleListView } from './schedule.view';

// 스케줄 읽기. 주인만 (지시에 비공개 일이 적혀 있을 수 있다).
@Injectable()
export class ScheduleQuery extends BaseQuery {
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
}
