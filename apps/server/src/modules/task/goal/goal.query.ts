import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BaseQuery,
  NotFound,
  SettingActor,
  type SettingChangeInput,
} from '../../platform';
import { Task } from '../task/task';
import { goals } from '../task.schema';
import type { GoalRow } from '../task.tables';
import { GoalListView, GoalSettingsView, GoalSettingView, GoalView } from './goal.view';

// 목표 읽기. 주인만 (대화로 바꾸는 설정의 읽기는 확인을 거친 제안자 SettingActor, 2026-11-15 D). 목표마다 이어진 작업의 수를 함께 센다 (목표별 작업 목록은 GET /api/tasks?goalId=).
@Injectable()
export class GoalQuery extends BaseQuery {
  private static readonly OPEN: readonly string[] = [Task.QUEUED, Task.RUNNING, Task.WAITING];

  async list(actor: Actor): Promise<GoalListView> {
    actor.assertOwner();
    const rows = await this.sql<(GoalRow & { open_tasks: number; done_tasks: number })[]>`
      SELECT g.*,
        count(t.id) FILTER (WHERE t.status = ANY(${GoalQuery.OPEN as string[]})) AS open_tasks,
        count(t.id) FILTER (WHERE t.status = ${Task.DONE}) AS done_tasks
      FROM task.goals g
      LEFT JOIN task.tasks t ON t.goal_id = g.id
      WHERE g.space_id = ${actor.spaceId}
      GROUP BY g.id
      ORDER BY g.sort, g.id`;
    return new GoalListView(rows.map((r) => new GoalView(r, r.open_tasks, r.done_tasks)));
  }

  /** get_settings { kind: goals } */
  async settings(actor: Actor): Promise<GoalSettingsView> {
    const spaceId = SettingActor.spaceOf(actor);
    return new GoalSettingsView(
      await this.rows(goals, { space_id: spaceId }, { order: ['sort', 'id'] }),
    );
  }

  /** 제안의 지금 값. 만들기면 null */
  async settingNow(actor: Actor, change: SettingChangeInput): Promise<GoalSettingView | null> {
    const spaceId = SettingActor.spaceOf(actor);
    if (change.targetId === null) return null;
    const row = await this.row(goals, { space_id: spaceId, id: change.targetId });
    if (!row) throw new NotFound('목표를 찾을 수 없어요');
    return new GoalSettingView(row);
  }
}
