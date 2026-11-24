import { Injectable } from '@nestjs/common';
import {
  ActionChecks,
  Actor,
  AgentActor,
  BaseService,
  Conflict,
  Database,
  Forbidden,
  NotFound,
  RuleViolation,
} from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { AppApproval } from '../approval/app-approval.policy';
import { Approval } from '../approval/approval';
import { ApprovalRepository } from '../approval/approval.repository';
import { TaskRepository } from '../task/task.repository';
import { ChatRepository } from './chat.repository';
import type { PublishAppInput } from './chat-publish.input';
import { AppPublishedView } from './chat-publish.view';
import { OwnerAsk } from './owner-ask.policy';

// 대화에서 앱 배포 · 수정 (2026-11-24, 원칙 7의 예외, 기획서 결정): 관리자가 콘솔의 대화에 "배포해줘" · "고쳐줘"라고 쓰면
// 대표가 그 말을 그대로 인용해 MCP publish_app을 부른다. 서버가 인용이 관리자의 말인지(OwnerAsk) 보고 바로 승인한 결재를 남긴다
// (AppApproval.ownerAsked: ship이면 blog가 앱을 공개로 바꾼다). 이 대화에서 기다리던 그 앱의 코드 공개(카드에 실리지 않은 것)도
// 함께 승인하고, 24시간 동안 같은 대화에서 나온 그 앱의 새 버전은 기다리지 않고 반영된다 (ChatResultService.offerAppCode).
// 앱 공개 전에 빠진 점(커뮤니티의 도메인 확인)은 blog가 platform ActionChecks로 짚는다
@Injectable()
export class ChatPublishService extends BaseService {
  /** blog의 빠진 점 가운데 앱이 없다는 말 (AppQuery.publishProblem과 같은 글) */
  static readonly NO_APP = '없는 앱이에요';

  constructor(
    db: Database,
    private readonly checks: ActionChecks,
  ) {
    super(db);
  }

  async publish(actor: Actor, req: PublishAppInput): Promise<AppPublishedView> {
    actor.assertCan(Actor.AGENT);
    if (!(actor instanceof AgentActor) || !actor.spaceId || !actor.id)
      throw new Forbidden(Actor.AGENT);
    const { spaceId, id: agentId, taskId } = actor;
    const [problem] = await this.checks.problemsOf(actor, [
      { action: Approval.PUBLISH_APP, targetId: req.appId },
    ]);
    if (problem === ChatPublishService.NO_APP) throw new NotFound(problem);
    const now = new Date();
    return this.transaction(async (tx) => {
      const task = await new TaskRepository(tx).lockById(taskId);
      const lead = await new AgentRepository(tx).findLead(spaceId);
      if (task?.spaceId !== spaceId || task.agentId !== agentId || lead?.id !== agentId)
        throw new Forbidden(Actor.AGENT, '대화를 맡은 대표만 배포해요');
      if (!task.open) throw new Conflict('끝난 회차예요');
      const chats = new ChatRepository(tx);
      const place = await chats.placeOf(taskId);
      if (!place || place.root_id !== taskId)
        throw new Forbidden(Actor.AGENT, '대화를 맡은 대표만 배포해요');
      const words = await chats.ownerWords(spaceId, place.chat_id, AppApproval.askedSince(now));
      const scope = OwnerAsk.scopeOf(req.quote, words);
      // 공개로 바꿀 때만 빠진 점을 본다 (이미 공개된 앱을 고치는 일은 막지 않는다)
      if (scope === 'ship' && problem) throw new RuleViolation(problem);
      const approvals = new ApprovalRepository(tx);
      const quote = req.quote.trim();
      await approvals.save(
        AppApproval.ownerAsked(spaceId, place.chat_id, agentId, req.appId, { quote, scope }, now),
      );
      const waiting = await approvals.lockUncardedAppCode(place.chat_id, req.appId);
      for (const approval of waiting) {
        approval.grantAsked(agentId, quote, now);
        await approvals.save(approval);
      }
      const until = new Date(now.getTime() + AppApproval.ASK_HOURS * 3_600_000);
      return new AppPublishedView(req.appId, scope, waiting.length, until);
    });
  }
}
