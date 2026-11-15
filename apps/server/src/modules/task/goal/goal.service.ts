import { Injectable } from '@nestjs/common';
import {
  type Actor,
  EntityService,
  Idempotency,
  SettingActor,
  type SettingChangeInput,
  SettingOutcome,
  type Sql,
} from '../../platform';
import { SettingChanges } from '../setting-change/setting-change.policy';
import type { Goal } from './goal';
import type { CreateGoalInput, GoalStatusInput, UpdateGoalInput } from './goal.input';
import { GoalRepository } from './goal.repository';
import { GoalEdit } from './goal-edit';

// 목표 쓰기: 만들기, 고치기, 상태 바꾸기. 목표를 정하는 건 주인이다: 화면에서 바로, 또는 대화에서 AI가 제안한 것을
// 승인해서 (2026-11-15 D, 설정 바꾸기). 만들기는 GoalEdit 한 줄을 함께 지난다.
@Injectable()
export class GoalService extends EntityService<Goal> {
  private static readonly CREATE = 'create_goal';

  protected store(tx: Sql): GoalRepository {
    return new GoalRepository(tx);
  }

  /** 같은 requestId가 다시 오면 처음 만든 것을 돌려준다. 부모는 진행 중이어야 한다 */
  async create(actor: Actor, req: CreateGoalInput): Promise<Goal> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const goals = new GoalRepository(tx);
      const once = new Idempotency(tx, actor.id ?? spaceId, req.requestId, GoalService.CREATE);
      const before = await once.previous();
      if (before) return goals.load(spaceId, String(before.goalId));
      const goal = await new GoalEdit(tx, spaceId).open(req, new Date());
      await goals.save(goal);
      await once.remember({ goalId: goal.id });
      return goal;
    });
  }

  /** 본 version이 지금과 다르면 409 */
  update(actor: Actor, req: UpdateGoalInput): Promise<Goal> {
    return this.changeAsOwner(actor, req, (goal) => goal.edit(req.changes));
  }

  /** 끝내기 · 그만두기 · 다시 열기. 이어진 작업은 그대로 간다 */
  changeStatus(actor: Actor, req: GoalStatusInput): Promise<Goal> {
    return this.changeAsOwner(actor, req, (goal) => goal.changeStatus(req.status));
  }

  /** 설정 바꾸기 제안의 미리 해 보기 (2026-11-15 D): 같은 줄(GoalEdit)을 지나고 저장하지 않는다 */
  async rehearseSetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingActor.spaceOf(actor);
    await this.transaction(async (tx) => {
      await new GoalEdit(tx, spaceId).apply(change, new Date());
    });
  }

  /** 승인한 설정 바꾸기: 결재마다 한 번 적용하고 결과(task.setting.changed)를 남긴다. 승인한 뒤 바뀌었으면 실패 */
  async applySetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingOutcome.spaceOf(actor, change.key);
    await SettingOutcome.settle(
      (work) => this.transaction(work),
      SettingChanges.TOPIC,
      spaceId,
      change.key,
      async (tx) => {
        await new GoalRepository(tx).save(
          await new GoalEdit(tx, spaceId).apply(change, new Date()),
        );
      },
    );
  }
}
