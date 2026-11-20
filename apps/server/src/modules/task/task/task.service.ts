import { Injectable } from '@nestjs/common';
import {
  Actor,
  AgentActor,
  BaseService,
  Conflict,
  Database,
  Forbidden,
  RuleViolation,
  type Sql,
  type VersionInput,
} from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { ApprovalRepository } from '../approval/approval.repository';
import { GoalRepository } from '../goal/goal.repository';
import { OutputQuery } from '../output/output.query';
import { SkillQuery } from '../skill/skill.query';
import { CodeScope } from './code-scope';
import { DelegationPolicy } from './delegation.policy';
import { Lessons } from './lesson.policy';
import { LessonQuery } from './lesson.query';
import type { AskHelpInput, WaitSubtasksInput } from './subtask-wait.input';
import { SubtaskWait } from './subtask-wait.policy';
import { HelpAskedView } from './subtask-wait.view';
import { Task } from './task';
import { CreateTaskInput, type DelegateTaskInput, type TaskIdInput } from './task.input';
import { TaskQuery } from './task.query';
import { TaskRepository } from './task.repository';

// 작업 쓰기: 만들기와 취소(주인), 일 요청(이벤트), 위임(에이전트가 작업 토큰으로)과 하위 작업이 끝났을 때 위 작업 깨우기(일꾼).
// 팀원 기다리기 (2026-11-19, SubtaskWait): 기한 · 실패 · 관리자 재촉으로 먼저 깨우기, 더 기다리기(wait_subtasks).
// 러너 쪽(빌리기 · 진행 · 끝내기 · 돌려주기 · 끝난 임대 되돌리기)은 JobService.
// 잠그는 순서는 어디서나 작업 → 결재 → 에이전트.
@Injectable()
export class TaskService extends BaseService {
  constructor(
    db: Database,
    private readonly outputs: OutputQuery,
    private readonly query: TaskQuery,
    private readonly lessons: LessonQuery,
    private readonly skills: SkillQuery,
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

  /**
   * 피드백에서 배우기 (2026-11-20, Lessons): 지난 배우기 뒤로 관리자의 수정 요청 메모가 쌓였고 열린 배우기 일이
   * 없으면 대표에게 일 하나(지시문 틀 lessons)를 맡긴다. 공간 · 날마다 하나, 대표가 없으면(대화를 연 적이 없음) 하지 않는다
   */
  async learn(actor: Actor, spaceId: string): Promise<Task | null> {
    actor.assertCan(Actor.RUN);
    const leadId = await this.lessons.leadOf(actor, spaceId);
    if (leadId === null) return null;
    const last = await this.lessons.last(actor, spaceId);
    const notes = await this.lessons.notes(actor, spaceId, last?.created_at ?? null);
    if (!Lessons.due(last, notes.length)) return null;
    const instruction = (await this.skills.prompts(actor, spaceId)).fill(
      'lessons',
      Lessons.fields(notes),
    );
    const req = CreateTaskInput.from({
      requestId: Lessons.requestId(spaceId, new Date()),
      agentId: leadId,
      title: Lessons.TITLE,
      instruction,
      priority: Lessons.PRIORITY,
    });
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
      await TaskService.stop(tx, tasks, [task, ...below], now);
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
      const keys = req.subtasks.map((s) => DelegationPolicy.requestIdOf(parent.id, s.requestId));
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
      const kinds = req.subtasks.map((s) => String(s.fields.kind ?? Task.GENERAL));
      const until = SubtaskWait.until(now, req.waitMinutes, kinds);
      parent.waitForSubtasks(`하위 작업 ${made.length}개를 맡겼어요`, until, now);
      await tasks.save(parent);
      return made;
    });
  }

  /**
   * 먼저 깨어난 위 작업이 끝나지 않은 하위 작업을 더 기다린다 (MCP wait_subtasks). 위임처럼 라운드 하나를 쓴다.
   * cancel의 하위 작업(바로 아래, 끝나지 않은 것)은 그 아래까지 멈추고, 남은 것을 기한까지 기다린다.
   * 남은 것이 없으면 러너가 AI를 끈 뒤 곧 깨운다 (그사이 끝난 결과는 다음 실행이 받는다). 답은 기다리는 하위 작업
   */
  async waitMore(actor: Actor, req: WaitSubtasksInput): Promise<readonly Task[]> {
    actor.assertCan(Actor.AGENT);
    if (!(actor instanceof AgentActor) || !actor.spaceId) throw new Forbidden(Actor.AGENT);
    const { spaceId, agentId, taskId } = actor;
    const now = new Date();
    return this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const parent = await tasks.lock(spaceId, taskId);
      // 기다리기도 위임처럼 살아 있는 임대 · 라운드 한도 · 관리자 재촉을 본다 (한 번 더 맡기는 것과 같은 자리)
      parent.assertCanDelegate(agentId, 1, 0, now);
      const children = await tasks.children(parent.id);
      const open = children.filter((c) => c.open && !req.cancel.includes(c.id));
      SubtaskWait.assertLeft(open.length, req.cancel.length);
      const stopping: Task[] = [];
      for (const id of req.cancel) {
        const child = children.find((c) => c.id === id && c.open);
        if (!child) throw new RuleViolation(`끝나지 않은 바로 아래 하위 작업이 아니에요: ${id}`);
        const locked = await tasks.lockById(child.id);
        if (locked) stopping.push(locked, ...(await tasks.lockOpenDescendants(child.id)));
      }
      await TaskService.stop(tx, tasks, stopping, now);
      const until =
        open.length > 0 ? SubtaskWait.until(now, req.minutes, []) : SubtaskWait.soon(now);
      parent.waitForSubtasks(`하위 작업 ${open.length}개를 더 기다려요`, until, now);
      await tasks.save(parent);
      return open;
    });
  }

  /**
   * 팀원이 나눌 부분을 적어 도움을 청한다 (MCP ask_help, 2026-11-20): 실행 기록 한 줄을 남기고, 팀장(위 작업)이 하위 작업을
   * 기다리는 중이면 먼저 깨운다 (SubtaskWait.HELP). 일 하나에 HELP_MAX번. 잠그는 순서는 위 작업 → 아래 작업
   */
  async askHelp(actor: Actor, req: AskHelpInput): Promise<HelpAskedView> {
    actor.assertCan(Actor.AGENT);
    if (!(actor instanceof AgentActor) || !actor.spaceId) throw new Forbidden(Actor.AGENT);
    const { spaceId, agentId, taskId } = actor;
    const asked = (await this.query.progressOf(actor, [taskId])).get(taskId) ?? [];
    SubtaskWait.assertHelpLeft(asked.filter((l) => l.startsWith(SubtaskWait.HELP_PREFIX)).length);
    const now = new Date();
    return this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const parentId = await tasks.parentOf(taskId);
      const parent = parentId === null ? null : await tasks.lockById(parentId);
      const task = await tasks.lock(spaceId, taskId);
      task.askHelp(agentId, req.part, now);
      await tasks.save(task);
      if (!parent?.waitingForSubtasks) return new HelpAskedView(false);
      parent.wakeAfterSubtasks(SubtaskWait.HELP, now);
      await tasks.save(parent);
      return new HelpAskedView(true);
    });
  }

  /** 관리자가 지금까지의 결과로 답하라고 한다 (대화의 팀 칸 "지금까지로 답하기"). 기다리는 중이면 바로 깨운다 */
  async hurry(actor: Actor, req: TaskIdInput): Promise<Task> {
    actor.assertOwner();
    const spaceId = TaskService.spaceOf(actor);
    return this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const task = await tasks.lock(spaceId, req.id);
      task.hurry(new Date());
      await tasks.save(task);
      return task;
    });
  }

  /** 기다리는 기한이 지난 위 작업을 깨운다 (마감 작업 SubtaskWaitJob). 하나씩 잠가 기한을 다시 본다 */
  async wakeOverdue(actor: Actor, ids: readonly string[], now: Date): Promise<void> {
    actor.assertCan(Actor.RUN);
    for (const id of ids)
      await this.transaction(async (tx) => {
        const tasks = new TaskRepository(tx);
        const task = await tasks.lockById(id);
        if (!task) return;
        task.wakeIfOverdue(now);
        await tasks.save(task);
      });
  }

  /**
   * 하위 작업 하나가 끝났다 (일꾼이 task.task.changed로 부른다). 형제가 모두 끝났거나 이것이 실패했으면
   * 위 작업을 대기열로 돌린다 (SubtaskWait.wakeOn: 실패는 형제를 기다리지 않고 바로, 팀원 기다리기).
   * 위 작업만 잠그고 세므로, 둘이 동시에 끝나도 늦게 커밋한 쪽이 깨운다. 두 번 불려도 같다
   */
  async settleSubtask(actor: Actor, taskId: string, status: string): Promise<void> {
    actor.assertCan(Actor.RUN);
    await this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const parentId = await tasks.parentOf(taskId);
      const parent = parentId === null ? null : await tasks.lockById(parentId);
      if (!parent?.waitingForSubtasks) return;
      const reason = SubtaskWait.wakeOn(status, await tasks.openChildren(parent.id));
      if (reason === null) return;
      parent.wakeAfterSubtasks(reason, new Date());
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

  /** 작업들을 멈추고 기다리던 결재도 닫는다. 작업은 모두 먼저 잠가 둔다 (잠그는 순서: 작업 → 결재) */
  private static async stop(
    tx: Sql,
    tasks: TaskRepository,
    list: readonly Task[],
    now: Date,
  ): Promise<void> {
    const approvals = new ApprovalRepository(tx);
    for (const one of list) {
      one.cancel(now);
      await tasks.save(one);
      const pending = await approvals.lockPending(one.id);
      if (!pending) continue;
      pending.cancel();
      await approvals.save(pending);
    }
  }

  private static spaceOf(actor: Actor): string {
    if (!actor.spaceId) throw new Forbidden(Actor.RUN);
    return actor.spaceId;
  }
}
