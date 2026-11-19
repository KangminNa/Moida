import { Injectable } from '@nestjs/common';
import {
  Actor,
  AgentActor,
  BaseService,
  Conflict,
  Database,
  Forbidden,
  type VersionInput,
} from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { ApprovalRepository } from '../approval/approval.repository';
import { GoalRepository } from '../goal/goal.repository';
import { OutputQuery } from '../output/output.query';
import { CodeScope } from './code-scope';
import { Task } from './task';
import type { CreateTaskInput, DelegateTaskInput } from './task.input';
import { TaskRepository } from './task.repository';

// 작업 쓰기: 만들기와 취소(주인), 일 요청(이벤트), 위임(에이전트가 작업 토큰으로)과 하위 작업이 끝났을 때 위 작업 깨우기(일꾼).
// 러너 쪽(빌리기 · 진행 · 끝내기 · 돌려주기 · 끝난 임대 되돌리기)은 JobService.
// 잠그는 순서는 어디서나 작업 → 결재 → 에이전트.
@Injectable()
export class TaskService extends BaseService {
  constructor(
    db: Database,
    private readonly outputs: OutputQuery,
  ) {
    super(db);
  }

  /** 콘솔에서 시키는 일. 같은 requestId가 다시 오면 처음 만든 작업을 돌려준다 */
  async create(actor: Actor, req: CreateTaskInput): Promise<Task> {
    actor.assertOwner();
    return this.open(actor, TaskService.spaceOf(actor), req);
  }

  /** 다른 모듈이 이벤트로 요청한 일 (일꾼이 부른다). 같은 이벤트가 두 번 와도 작업은 하나 */
  async request(actor: Actor, spaceId: string, req: CreateTaskInput): Promise<Task> {
    actor.assertCan(Actor.RUN);
    return this.open(actor, spaceId, req);
  }

  /** 주인이 멈춘다. 기다리던 결재도 닫고, 끝나지 않은 아래 작업(위임)도 함께 멈춘다 */
  async cancel(actor: Actor, req: VersionInput): Promise<Task> {
    actor.assertOwner();
    const spaceId = TaskService.spaceOf(actor);
    const now = new Date();
    return this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const task = await tasks.lock(spaceId, req.id);
      task.assertVersion(req.version);
      // 잠그는 순서는 위 작업 → 아래 작업 → 결재 (작업은 모두 먼저 잠갔다)
      const below = await tasks.lockOpenDescendants(task.id);
      const approvals = new ApprovalRepository(tx);
      for (const one of [task, ...below]) {
        one.cancel(now);
        await tasks.save(one);
        const pending = await approvals.lockPending(one.id);
        if (!pending) continue;
        pending.cancel();
        await approvals.save(pending);
      }
      return task;
    });
  }

  /**
   * 에이전트가 바로 아래 팀에게 하위 작업을 맡긴다 (delegate_task). 작업은 하위 작업을 기다리고,
   * 러너는 결재 대기처럼 AI를 끄고 제출하지 않는다. 같은 request_id들로 다시 보내면 처음 만든 하위 작업을 돌려준다.
   */
  async delegate(actor: Actor, req: DelegateTaskInput): Promise<readonly Task[]> {
    actor.assertCan(Actor.AGENT);
    if (!(actor instanceof AgentActor) || !actor.spaceId) throw new Forbidden(Actor.AGENT);
    const { spaceId, agentId, taskId } = actor;
    const now = new Date();
    return this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const parent = await tasks.lock(spaceId, taskId);
      const keys = req.subtasks.map((s) => parent.subtaskRequestId(s.requestId));
      const before = await tasks.findByRequests(spaceId, keys);
      if (before.length > 0) {
        // 응답을 놓쳐 같은 호출을 다시 보냈다: 그때 만든 것을 그대로. 일부만 겹치면 다른 호출이다
        if (before.length === keys.length)
          return keys.map((k) => before.find((t) => t.requestId === k) as Task);
        throw new Conflict('이미 쓴 request_id예요. 새 하위 작업에는 새 request_id를 써 주세요');
      }
      const siblings = await tasks.children(parent.id);
      parent.assertCanDelegate(agentId, req.subtasks.length, siblings.length, now);
      const org = await new AgentRepository(tx).all(spaceId);
      const manager = org.find((a) => a.id === agentId);
      if (!manager) throw new Forbidden(Actor.AGENT);
      const tainted = await tasks.privateTouched(spaceId, parent.id);
      const made = req.subtasks.map((s) =>
        parent.subtask(manager, org.find((a) => a.id === s.toAgentId) ?? null, s, now, tainted),
      );
      // 코드 하위 작업끼리(아직 안 끝난 형제 포함) 고칠 곳이 겹치면 PR이 부딪친다
      CodeScope.assertApart(
        [...siblings.filter((t) => t.open), ...made].flatMap((t) => t.codeScope ?? []),
      );
      for (const child of made)
        if (!(await tasks.insertOnce(child)))
          throw new Conflict('같은 하위 작업이 동시에 만들어졌어요. 다시 보내 주세요');
      parent.waitForSubtasks(made.length, now);
      await tasks.save(parent);
      return made;
    });
  }

  /**
   * 하위 작업 하나가 끝났다 (일꾼이 task.task.changed로 부른다). 형제가 모두 끝났으면 위 작업을 대기열로 돌린다.
   * 위 작업만 잠그고 세므로, 둘이 동시에 끝나도 늦게 커밋한 쪽이 깨운다. 두 번 불려도 같다
   */
  async settleSubtask(actor: Actor, taskId: string): Promise<void> {
    actor.assertCan(Actor.RUN);
    await this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const parentId = await tasks.parentOf(taskId);
      const parent = parentId === null ? null : await tasks.lockById(parentId);
      if (!parent?.waitingForSubtasks) return;
      if ((await tasks.openChildren(parent.id)) > 0) return;
      parent.wakeAfterSubtasks(new Date());
      await tasks.save(parent);
    });
  }

  private async open(actor: Actor, spaceId: string, req: CreateTaskInput): Promise<Task> {
    const task = Task.open(spaceId, req.requestId, req.fields, new Date());
    // 만들기의 재료 결과물은 트랜잭션 밖에서 미리 본다. 그사이 휴지통에 가면 러너가 받을 때 빼고 기록한다
    const materials = task.makeMaterials;
    if (materials !== null && materials.outputs.length > 0)
      materials.assertLive(await this.outputs.liveIds(actor, spaceId, materials.outputs));
    return this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const { agent_id: agentId = null, goal_id: goalId = null } = req.fields;
      if (agentId !== null) await new AgentRepository(tx).load(spaceId, agentId);
      // 목표는 진행 중이어야 한다. 잠그지 않는다: 그사이 끝나도 이어진 작업은 그대로 가는 것과 같다
      if (goalId !== null) (await new GoalRepository(tx).load(spaceId, goalId)).assertActive();
      return (await tasks.insertOnce(task)) ? task : tasks.findByRequest(spaceId, req.requestId);
    });
  }

  private static spaceOf(actor: Actor): string {
    if (!actor.spaceId) throw new Forbidden(Actor.RUN);
    return actor.spaceId;
  }
}
