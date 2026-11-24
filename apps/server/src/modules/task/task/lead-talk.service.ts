import { Injectable } from '@nestjs/common';
import { Actor, AgentActor, BaseService, Database, Forbidden, NotFound } from '../../platform';
import type { AskLeadInput, ReplyWorkersInput } from './lead-talk.input';
import { LeadTalk } from './lead-talk.policy';
import { LeadAskedView, WorkersRepliedView } from './lead-talk.view';
import { SubtaskWait } from './subtask-wait.policy';
import { Task } from './task';
import { TaskRepository } from './task.repository';

/**
 * 대표 ↔ 일꾼 대화 (2026-11-24, LeadTalk): 일꾼이 묻고(ask_lead) 대표가 답한다(reply_worker). 작업 토큰으로만 (누가 어느 일에서
 * 부르는지는 토큰에서). 잠그는 순서는 위 작업(대표) → 아래 작업(일꾼). 상태 바꾸기는 Task의 메서드로만 한다
 */
@Injectable()
export class LeadTalkService extends BaseService {
  constructor(db: Database) {
    super(db);
  }

  /**
   * 일꾼이 묻는다: 맡긴 일 · 살아 있는 임대 · 이 에이전트의 일만 (ask_help와 같은 조건, Task.askHelp가 본다). 그 일은 답을
   * 기다리고(waiting lead) 대표가 하위 작업을 기다리는 중이면 먼저 깨운다 (SubtaskWait.QUESTION)
   */
  async ask(actor: Actor, req: AskLeadInput): Promise<LeadAskedView> {
    const { spaceId, agentId, taskId } = LeadTalkService.agentOf(actor);
    const now = new Date();
    return this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const parentId = await tasks.parentOf(taskId);
      const parent = parentId === null ? null : await tasks.lockById(parentId);
      const task = await tasks.lock(spaceId, taskId);
      task.askHelp(agentId, LeadTalk.askLine(req.question), now);
      task.declare((p) => LeadTalk.asked(p, req.question));
      task.waitFor(now, LeadTalk.WAIT);
      await tasks.save(task);
      if (!parent?.waitingForSubtasks) return new LeadAskedView(false);
      parent.wakeAfterSubtasks(SubtaskWait.QUESTION, now);
      await tasks.save(parent);
      return new LeadAskedView(true);
    });
  }

  /**
   * 대표가 답한다: 이 일이 맡긴 바로 아래 일 가운데 답을 기다리는 것만. 답은 그 일의 payload에 쌓이고 일은 대기열로 돌아가
   * 이어서 한다. 대표는 다시 하위 작업을 기다린다 (라운드를 쓰지 않는다: 대화는 위임이 아니다). 관리자가 재촉했으면 거절
   */
  async reply(actor: Actor, req: ReplyWorkersInput): Promise<WorkersRepliedView> {
    const { spaceId, agentId, taskId } = LeadTalkService.agentOf(actor);
    const now = new Date();
    return this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const lead = await tasks.lock(spaceId, taskId);
      if (lead.agentId !== agentId)
        throw new Forbidden(Actor.AGENT, '이 에이전트의 작업이 아니에요');
      lead.declare(LeadTalk.rewaitable);
      for (const reply of req.replies) {
        const worker =
          (await tasks.parentOf(reply.taskId)) === lead.id
            ? await tasks.lockById(reply.taskId)
            : null;
        if (!worker) throw new NotFound(`이 일이 맡긴 바로 아래 일이 아니에요: ${reply.taskId}`);
        worker.declare((p) => LeadTalk.answered(p, reply.text));
        worker.reopen(LeadTalk.WAIT);
        worker.log(Task.LOG_READ, LeadTalk.answerLine(reply.text), 0, now);
        await tasks.save(worker);
      }
      const until = SubtaskWait.until(now, null, []);
      lead.waitForSubtasks(
        `일꾼 ${req.replies.length}명에게 답하고 다시 기다려요`,
        until,
        now,
        false,
      );
      await tasks.save(lead);
      return new WorkersRepliedView(req.replies.length);
    });
  }

  private static agentOf(actor: Actor): AgentActor & { spaceId: string } {
    actor.assertCan(Actor.AGENT);
    if (!(actor instanceof AgentActor) || !actor.spaceId) throw new Forbidden(Actor.AGENT);
    return actor as AgentActor & { spaceId: string };
  }
}
