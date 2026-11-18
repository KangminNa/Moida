import { Injectable } from '@nestjs/common';
import {
  ActionChecks,
  type Actor,
  BaseService,
  Database,
  Forbidden,
  Idempotency,
  SystemActor,
} from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { Approval } from '../approval/approval';
import { ApprovalRepository } from '../approval/approval.repository';
import { OutputRepository } from '../output/output.repository';
import { SkillQuery } from '../skill/skill.query';
import { Task } from '../task/task';
import { TaskRepository } from '../task/task.repository';
import type { AppCodeAddedInput } from './chat.input';
import { ChatRepository } from './chat.repository';
import { ChatResult } from './chat-result.policy';
import { ChatReview } from './chat-review.policy';

// 결과 결재 (2차 2단계 · 기획서 결정 2026-11-14): 대화의 일이 바뀔 때마다(작업 상태 · 결재 요청) 회차가 가라앉았는지 보고
// 다음 하나를 한다: 받을 것이 없으면 다시 맡김(result-check) · 검토자 짝의 검토(result-review) ·
// 검토가 고칠 것을 남겼으면 한 번 다시 맡김(result-fix, 검증 고리 V) · 결과 카드.
// 받을 것이 있어도 동작의 대상을 가진 모듈이 빠진 점을 짚으면(platform ActionChecks, 2차 6단계) 다시 맡긴다.
// 카드에 실을 때 같은 이름의 결과물은 마지막 것만 싣고 앞의 것은 휴지통으로 (다시 맡긴 회차가 고쳐 낸 것, 검증 고리 V).
// 카드 · 실린 결재 · 결과물은 함께 바뀌어야 해서 같은 트랜잭션에서 여러 묶음을 쓴다 (ApprovalService와 같은 까닭).
// 대화를 먼저 잠가 같은 대화의 판단은 하나씩 한다. 잠그는 순서: 대화 → 결재 → 결과물.
// 카드의 결정(고른 것만 남기기)은 ApprovalService.decide, 수정 요청 · 반려 뒤의 정리는 ChatService.closeByCard
@Injectable()
export class ChatResultService extends BaseService {
  private static readonly APP_CODE = 'app_code_card';

  constructor(
    db: Database,
    private readonly skills: SkillQuery,
    private readonly checks: ActionChecks,
  ) {
    super(db);
  }

  /** 작업 하나가 바뀌었다. 대화의 일이 아니면 아무것도 하지 않는다. 두 번 불려도 같다 (카드는 대화마다 하나, 일은 request_id로 하나) */
  async settle(actor: Actor, spaceId: string, taskId: string): Promise<void> {
    if (!(actor instanceof SystemActor)) throw new Forbidden('system');
    const chatId = await this.transaction((tx) => new TaskRepository(tx).chatOf(taskId));
    if (chatId === null) return;
    const prompts = await this.skills.prompts(actor, spaceId);
    const now = new Date();
    await this.transaction(async (tx) => {
      const chats = new ChatRepository(tx);
      const chat = await chats.lock(spaceId, chatId);
      if (chat.agentId === null || (await chats.busy(chat))) return;
      const approvals = new ApprovalRepository(tx);
      const outputs = new OutputRepository(tx);
      const actions = await approvals.lockUncarded(chat.id);
      const open = await approvals.lockOpenCard(chat.id);
      const made = await outputs.uncardedInChat(spaceId, chat.id);
      const turn = await chats.turnState(chat);
      const previous = await chats.previousTurns(chat, spaceId);
      const agents = await new AgentRepository(tx).all(spaceId);
      const partner = agents.find((a) => a.id === chat.agentId);
      const reviewer = agents.find((a) => a.id === partner?.reviewerId && !a.deleted) ?? null;
      // 받을 것이 있어도 그 동작의 대상을 가진 모듈이 짚는 빠진 점 (2차 6단계: 메뉴에 올리지 않은 글의 발행)
      const problems = chat.deliver
        ? await this.checks.problemsOf(
            actor,
            actions.map((a) => ({ action: a.action, targetId: a.targetId })),
          )
        : [];
      const missing =
        ChatResult.missing(
          chat.deliver,
          actions.map((a) => a.action),
          made.map((o) => o.name),
        ) ?? (problems.length > 0 ? chat.deliver : null);
      const review =
        turn.review_status === Task.DONE
          ? ChatReview.parse(ChatResult.textOf(turn.review_result))
          : null;
      const step = ChatResult.next({
        root: turn.status,
        items: actions.length + made.length,
        missing: missing !== null,
        carded: open !== null && open.targetVersion === chat.turns,
        fixes: ChatResult.fixesIn(previous),
        reviewFixes: ChatResult.fixesIn(previous, ChatResult.BY_REVIEW),
        reviewer: reviewer !== null,
        reviewed: turn.review_status !== null,
        review,
      });
      const tasks = new TaskRepository(tx);
      if (step === ChatResult.FIX && partner && missing) {
        const message = prompts.fill('result-check', {
          deliver: missing,
          need: problems.length > 0 ? problems.join(' · ') : ChatResult.needOf(missing),
        });
        const task = chat.fix(partner, message, previous, now);
        await chats.save(chat);
        await tasks.insertOnce(task);
      } else if (step === ChatResult.REVIEW_FIX && partner && review) {
        const message = prompts.fill('result-fix', ChatReview.fixFields(review));
        const task = chat.fix(partner, message, previous, now, ChatResult.BY_REVIEW);
        await chats.save(chat);
        await tasks.insertOnce(task);
      } else if (step === ChatResult.REVIEW && reviewer) {
        const items = [...actions.map((a) => a.action), ...made.map((o) => o.name)];
        const instruction = prompts.fill('result-review', {
          goal: chat.goal,
          message: turn.instruction ?? '',
          answer: ChatResult.textOf(turn.result) || '-',
          items: items.map((name) => `- ${name}`).join('\n') || null,
        });
        await tasks.insertOnce(chat.review(reviewer, instruction, now));
      } else if (step === ChatResult.CARD) {
        const card = open ?? Approval.forChat(spaceId, chat.id, chat.partnerId, chat.turns, now);
        if (open) open.grew(chat.turns);
        await approvals.save(card);
        for (const action of actions) {
          action.bundleInto(card);
          await approvals.save(action);
        }
        // 다시 맡긴 회차가 있을 때만: 한 회차 안의 같은 이름(다른 팀원이 각자 낸 index.html 등)은 그대로 싣는다
        const replaced = new Set(
          ChatResult.fixesIn(previous) > 0 ? ChatResult.superseded(made).map((o) => o.id) : [],
        );
        for (const output of made) {
          if (replaced.has(output.id)) output.trash(now);
          else output.bundleInto(card.id);
          await outputs.save(output);
        }
      }
    });
  }

  /**
   * 대화의 만들기 일이 낸 앱 코드가 확인 대기 버전이 됐다 (blog.app_code.added, 스토어 1-6b): 그 대화의 결과 카드에
   * 공개 승인(Approval.forAppCode)을 싣는다. 결재 요청이 다시 settle을 불러 카드에 실린다. 대화의 일이 아니거나
   * 바로 보인 버전(비공개 앱)이면 아무것도 하지 않는다 (알림과 코드 탭이 맡는다). 같은 버전이 두 번 와도 결재는 하나
   */
  async offerAppCode(actor: Actor, spaceId: string, req: AppCodeAddedInput): Promise<void> {
    if (!(actor instanceof SystemActor)) throw new Forbidden('system');
    if (!req.offered || req.taskId === null) return;
    const taskId = req.taskId;
    const now = new Date();
    await this.transaction(async (tx) => {
      const chatId = await new TaskRepository(tx).chatOf(taskId);
      if (chatId === null) return;
      const chat = await new ChatRepository(tx).lock(spaceId, chatId);
      const once = new Idempotency(
        tx,
        spaceId,
        `${req.appId}:${req.seq}`,
        ChatResultService.APP_CODE,
      );
      if (await once.previous()) return;
      const approval = Approval.forAppCode(spaceId, chat.id, chat.partnerId, req, now);
      await new ApprovalRepository(tx).save(approval);
      await once.remember({ approvalId: approval.id });
    });
  }
}
