import { Injectable } from '@nestjs/common';
import { type Actor, BaseService, Database, Forbidden, SystemActor } from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { Approval } from '../approval/approval';
import { ApprovalRepository } from '../approval/approval.repository';
import { SkillQuery } from '../skill/skill.query';
import { Task } from '../task/task';
import { TaskRepository } from '../task/task.repository';
import { Verdict } from '../verdict/verdict';
import { VerdictRepository } from '../verdict/verdict.repository';
import { ChatRepository } from './chat.repository';
import { ChatHistory } from './chat-history.policy';
import { ChatInspect } from './chat-inspect.policy';
import { ChatResult } from './chat-result.policy';
import { ChatReview } from './chat-review.policy';

// 검수 반영 (기획서 결정 2026-11-20, ChatInspect): 검수 작업이 끝나면(완료 · 실패 · 취소) 그 결재에 검수의 결정을 적는다.
//   통과 → 검수자가 승인 (기다리던 작업은 관리자의 승인과 똑같이 이어지고, 대상을 가진 모듈이 실행한다)
//   고칠 것 → 올린 작업에 돌려준다 (고쳐 다시 올리면 다시 검수). 기다리는 작업이 없는 앱 화면은 대표에게 다시 맡긴다
//   그 밖 → 검수 의견을 메모에 붙여 기다리게 둔다: 결과 결재(ChatResultService)가 관리자의 카드에 싣는다
// 대표가 그사이 검수 승인을 끄거나 검토자를 바꿨으면 관리자에게 넘긴다. 결재 · 작업 · 대화는 함께 바뀌어야 해서
// 같은 트랜잭션에서 쓴다 (ChatResultService와 같은 까닭). 잠그는 순서: 대화 → 작업 → 결재
@Injectable()
export class ChatInspectService extends BaseService {
  private static readonly BY = 'inspect';
  private static readonly ENDED: readonly string[] = [Task.DONE, Task.FAILED, Task.CANCELLED];

  constructor(
    db: Database,
    private readonly skills: SkillQuery,
  ) {
    super(db);
  }

  /** 작업 하나가 바뀌었다. 끝난 검수 작업이 아니거나 그 결재를 이미 정했으면 아무것도 하지 않는다 (두 번 불려도 같다) */
  async apply(actor: Actor, spaceId: string, taskId: string): Promise<void> {
    if (!(actor instanceof SystemActor)) throw new Forbidden('system');
    const place = await this.transaction((tx) => new ChatRepository(tx).placeOf(taskId));
    const approvalId = ChatInspect.approvalOf(place?.payload);
    if (!place || approvalId === null || !ChatInspectService.ENDED.includes(place.status)) return;
    const prompts = await this.skills.prompts(actor, spaceId);
    const now = new Date();
    await this.transaction(async (tx) => {
      const approvals = new ApprovalRepository(tx);
      const seen = await approvals.findIn(spaceId, approvalId);
      if (!seen?.chatId || seen.status !== Approval.PENDING || seen.inspected) return;
      const chats = new ChatRepository(tx);
      const tasks = new TaskRepository(tx);
      const chat = await chats.lock(spaceId, seen.chatId);
      const task = seen.taskId === null ? null : await tasks.lock(spaceId, seen.taskId);
      const approval = await approvals.lock(spaceId, approvalId);
      if (approval.status !== Approval.PENDING || approval.inspected) return;
      const agents = await new AgentRepository(tx).all(spaceId);
      const lead = agents.find((a) => a.id === chat.agentId && a.reviewerApproves) ?? null;
      const inspector = place.agent_id;
      // 두 검수자 (2026-11-20): 둘 다 끝나야 정한다. 다른 하나가 아직 돌면 그 작업이 끝날 때 다시 온다.
      // 두 번째 검수 작업이 없으면(도중에 정했음) 끝내지 못한 것으로 보아 관리자에게
      const second = lead?.secondInspectorId ?? null;
      const judged =
        second === null ? [place] : await chats.inspections(spaceId, chat.id, approvalId);
      if (judged.some((t) => !ChatInspectService.ENDED.includes(t.status))) return;
      const reviews = judged.map((t) =>
        t.status === Task.DONE ? ChatReview.parse(ChatResult.textOf(t.result)) : null,
      );
      if (second !== null && reviews.length < 2) reviews.push(null);
      const review = ChatInspect.combine(reviews);
      const fixes = (await approvals.inspectorFixes(approval)).length;
      // 같은 검수자가 앞서 준 점수(두 검수자면 낮은 쪽): 고쳐 왔는데 오르지 않았으면 한도 전이라도 관리자에게
      const target = Verdict.inspectTarget(chat.id, approval.action, approval.targetId);
      const verdicts = new VerdictRepository(tx);
      const lastScores = await Promise.all(
        judged.map((t) =>
          t.agent_id === null ? null : verdicts.lastScore(spaceId, target, t.agent_id, t.id),
        ),
      );
      const before = lastScores.every((x) => x !== null)
        ? Math.min(...(lastScores as number[]))
        : null;
      const previous = await chats.previousTurns(chat, spaceId);
      // 앱 화면은 기다리는 작업이 없어 대표의 새 회차로 고친다: 관리자가 그사이 다음 말을 해 회차가 돌면 관리자에게
      const redo = task !== null || (lead !== null && !ChatHistory.waiting(previous.at(-1)));
      const inspectors = [lead?.reviewerId, second].filter(Boolean);
      const on = lead !== null && inspector !== null && inspectors.includes(inspector);
      const decided = on ? ChatInspect.outcome(review, fixes, before) : 'hold';
      const outcome = decided === 'fix' && !redo ? 'hold' : decided;
      const text = on
        ? ChatInspect.opinion(review, outcome, before)
        : '검수 승인이 꺼져 관리자에게 넘겨요';
      approval.inspect(outcome, lead?.reviewerId ?? inspector ?? chat.partnerId, text, now);
      await approvals.save(approval);
      if (task) {
        approval.applyTo(task, now);
        await tasks.save(task);
      } else if (outcome === 'fix' && lead && review) {
        const message = prompts.fill('result-fix', ChatReview.fixFields(review));
        const note = `검수자가 고칠 것 ${review.fixes.length}개를 남겨 다시 맡김`;
        const turn = chat.fix(lead, message, previous, now, { by: ChatInspectService.BY, note });
        await chats.save(chat);
        await tasks.insertOnce(turn);
      }
    });
  }
}
