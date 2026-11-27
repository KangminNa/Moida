import { Injectable } from '@nestjs/common';
import { Actor, BaseService, RuleViolation, type Sql } from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { type AfterOrderRow, SubtaskAfter } from './subtask-after.policy';
import { SubtaskOrder } from './subtask-order.input';
import { SubtaskVerify } from './subtask-verify.policy';
import { SubtaskWait } from './subtask-wait.policy';
import { Task } from './task';
import { TaskRepository } from './task.repository';

// 하위 작업이 끝났을 때 위 작업 쪽에서 할 일 (일꾼, SubtaskSettledHandler). TaskService에서 옮겼다 (2026-11-21, 줄 수).
//   1. 순서가 있는 위임 (D2 after): 앞 단계가 모두 끝난 적어 둔 하위 작업을 만들고 앞 결과를 넘긴다 (SubtaskAfter)
//   1-2. 검증 루프 (L2 verify): 끝난 하위 작업이 검증받기면 다른 일꾼에게 검증 일, 검증이 fix면 같은 일꾼에게 다시 (SubtaskVerify)
//   2. 팀원 기다리기: 기다리는 위 작업을 깨울지 본다 (SubtaskWait.wakeOn). 1이 새 하위 작업을 만들면 그만큼 아직 열려 있다
// 잠그는 순서는 위 작업 → 아래 작업. 두 번 와도 같다 (만든 하위 작업은 request_id로 하나, 적어 둔 것은 지운다)
@Injectable()
export class SubtaskService extends BaseService {
  async settle(actor: Actor, taskId: string, status: string): Promise<void> {
    actor.assertCan(Actor.RUN);
    const now = new Date();
    await this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const parentId = await tasks.parentOf(taskId);
      const parent = parentId === null ? null : await tasks.lockById(parentId);
      if (!parent) return;
      const held = parent.open ? await tasks.heldAfter(parent.id) : [];
      if (held.length > 0) await SubtaskService.startAfter(tx, tasks, parent, held, now);
      if (status === Task.DONE && parent.open)
        await SubtaskService.verifyLoop(tx, tasks, parent, taskId, now);
      if (!parent.waitingForSubtasks) return;
      const reason = SubtaskWait.wakeOn(status, await tasks.openChildren(parent.id));
      if (reason === null) return;
      parent.wakeAfterSubtasks(reason, now);
      await tasks.save(parent);
    });
  }

  /** 앞 단계가 끝난 적어 둔 하위 작업을 만든다. 맡을 수 없게 됐으면(팀원이 바뀜) 시작하지 않고 지운다 */
  private static async startAfter(
    tx: Sql,
    tasks: TaskRepository,
    parent: Task,
    held: readonly AfterOrderRow[],
    now: Date,
  ) {
    const siblings = await tasks.afterRows(parent.id);
    const plan = SubtaskAfter.due(held, siblings);
    if (plan.ready.length === 0 && plan.dropped.length === 0) return;
    const org = await new AgentRepository(tx).all(parent.spaceId);
    const manager = org.find((a) => a.id === parent.agentId);
    for (const item of plan.ready) {
      const order = SubtaskOrder.saved(item.order);
      const worker = org.find((a) => a.id === order.toAgentId) ?? null;
      if (!manager) break;
      try {
        const child = parent.subtask(manager, worker, order, now);
        child.declare((p) => ({ ...p, afterResults: SubtaskAfter.results(item, siblings) }));
        await tasks.insertOnce(child);
      } catch (error) {
        if (!(error instanceof RuleViolation)) throw error;
      }
    }
    parent.declare((p) => SubtaskAfter.withRest(p, plan.rest));
    await tasks.save(parent);
  }

  /** 검증 루프 (L2): 검증 일 · 다시 맡기기 하나를 만든다. 맡을 수 없게 됐거나 한도면 만들지 않고 대표에게 그대로 */
  private static async verifyLoop(
    tx: Sql,
    tasks: TaskRepository,
    parent: Task,
    taskId: string,
    now: Date,
  ) {
    const done = await tasks.verifyRow(taskId);
    if (!done) return;
    const org = await new AgentRepository(tx).all(parent.spaceId);
    const step = SubtaskVerify.next(done, org);
    const manager = org.find((a) => a.id === parent.agentId);
    if (step.kind === 'none' || !manager) return;
    const order = SubtaskOrder.saved(step.order);
    const worker = org.find((a) => a.id === order.toAgentId) ?? null;
    try {
      const child = parent.subtask(manager, worker, order, now);
      child.declare((p) => ({ ...p, ...step.seed }));
      await tasks.insertOnce(child);
    } catch (error) {
      if (!(error instanceof RuleViolation)) throw error;
    }
  }
}
