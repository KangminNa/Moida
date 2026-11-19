import { Injectable } from '@nestjs/common';
import {
  Actor,
  BaseService,
  Conflict,
  Database,
  Forbidden,
  Idempotency,
  LibraryQuery,
  Lookups,
  RuleViolation,
  type Sql,
  SystemActor,
  type VersionInput,
} from '../../platform';
import type { Agent } from '../agent/agent';
import { AgentRepository } from '../agent/agent.repository';
import { AgentEdit } from '../agent/agent-edit';
import { Approval } from '../approval/approval';
import { ApprovalRepository } from '../approval/approval.repository';
import { OutputQuery } from '../output/output.query';
import { ScheduleRepository } from '../schedule/schedule.repository';
import { SkillQuery } from '../skill/skill.query';
import { Task } from '../task/task';
import { TaskRepository } from '../task/task.repository';
import { type RefPick, TaskRefs } from '../task/task-refs.policy';
import { Chat } from './chat';
import type { AskAgentInput, CreateChatInput, SendChatInput, TuneChatInput } from './chat.input';
import { ChatRepository } from './chat.repository';
import { ChatHistory } from './chat-history.policy';
import { ChatProject } from './chat-project.policy';
import { ChatResult } from './chat-result.policy';
import { ChatUpdates } from './chat-update.policy';

// 대화 쓰기: 관리자(콘솔), 그리고 "에이전트에게 맡기기" 권한을 받은 기기(MCP ask_agent, 자기가 연 대화만). 대화와 회차 작업은 함께 바뀌어야 해서 같은 트랜잭션에서 쓴다 (목표 실행과 같은 이유).
// 대화 줄을 잠그고 앞 회차를 읽어서, 동시에 두 메시지를 보내도 회차는 하나만 생긴다 (둘째는 그 회차에 덧붙인 말이 된다, 2차 1-1).
// 상대(에이전트)는 잠그지 않는다: 바뀐 상대(팀원으로 옮김 · 멈춤 · 삭제)는 다음 메시지에서 걸린다.
// O-2 (2026-11-18): 상대는 늘 공간의 대표 (AgentEdit.lead, 없으면 만든다). 새 대화는 열 때 대표가 첫 회차를 맡고,
// O-2 전에 배정을 기다리던 대화는 다음 말에서 대표가 맡는다 (partnerOf). 승인 뒤 이어서는 continueAfter
@Injectable()
export class ChatService extends BaseService {
  private static readonly APPEND = 'chat_append';
  private static readonly CONTINUE = 'chat_continue';
  /** 참조는 새 회차에만 (덧붙인 말은 회차가 아니다) */
  private static readonly REFS_WAIT = '일하는 중에는 참조를 넣지 못해요. 답이 온 뒤에 보내요';

  constructor(
    db: Database,
    private readonly skills: SkillQuery,
    private readonly library: LibraryQuery,
    private readonly lookups: Lookups,
    private readonly outputs: OutputQuery,
  ) {
    super(db);
  }

  /** 새 대화와 첫 메시지: 대표가 맡아 첫 회차를 연다 (O-2). 같은 requestId는 처음 만든 대화 */
  async create(actor: Actor, req: CreateChatInput): Promise<Chat> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const refs = await this.refsOf(actor, req.refs);
    // 대화의 앱 (스토어 2단계): blog의 앱인지 platform Lookups로 (task는 blog를 모른다)
    if (req.appId !== null)
      await this.lookups.assertVisible('app', actor, [req.appId], '앱을 찾을 수 없어요');
    const now = new Date();
    return this.transaction(async (tx) => {
      const before = await new ChatRepository(tx).findByRequest(spaceId, req.requestId);
      if (before) return before;
      const chat = Chat.open(spaceId, req.requestId, req.message, now, {
        goal: req.goal,
        project: ChatProject.of(req.project),
        deliver: ChatResult.deliverOf(req.deliver),
        pending_refs: refs.empty ? null : refs.lines,
        app_id: req.appId,
      });
      await this.start(tx, chat, await new AgentEdit(tx, spaceId).lead(now), now);
      return chat;
    });
  }

  /**
   * 메시지 하나 = 다음 회차 작업 (끝나지 않은 회차가 있으면 덧붙인 말).
   * 같은 requestId를 다시 보내면 그대로 (본 version이 낡았어도)
   */
  async send(actor: Actor, req: SendChatInput): Promise<Chat> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const now = new Date();
    const refs = await this.refsOf(actor, req.refs);
    return this.transaction(async (tx) => {
      const chat = await new ChatRepository(tx).lock(spaceId, req.id);
      chat.assertSender(null);
      const seen = chat.agentId === null ? undefined : req.version; // 맡으면(partnerOf) 판이 오른다
      const lead = await this.partnerOf(tx, chat, now, req.version);
      const text = { requestId: req.requestId, message: req.message, refs };
      return this.talk(tx, actor, chat, lead, text, now, null, seen);
    });
  }

  /**
   * MCP ask_agent: "에이전트에게 맡기기"(delegate) 권한을 받은 기기(내 컴퓨터의 AI 도구)가 서버 팀(대표)에 메시지를 보낸다.
   * chatId가 없으면 새 대화(목표 · 프로젝트와 함께), 있으면 그 기기가 연 대화에 이어 보낸다.
   * 같은 requestId는 한 번만. 기기의 메시지라고 남긴다 (read_url의 기준에 넣지 않게). 결재는 이 길로 하지 못한다
   */
  async ask(actor: Actor, req: AskAgentInput): Promise<Chat> {
    actor.assertCan(Actor.DELEGATE);
    if (actor.kind !== 'device' || !actor.id) throw new Forbidden(Actor.DELEGATE);
    const deviceId = actor.id;
    const spaceId = actor.requireSpace();
    const now = new Date();
    return this.transaction(async (tx) => {
      const chats = new ChatRepository(tx);
      if (req.chatId === null) {
        const before = await chats.findByRequest(spaceId, req.requestId);
        before?.assertSender(deviceId);
        if (before) return before;
        const chat = Chat.open(spaceId, req.requestId, req.message, now, {
          device_id: deviceId,
          goal: req.goal,
          project: ChatProject.of(req.project),
          deliver: ChatResult.deliverOf(req.deliver),
        });
        await this.start(tx, chat, await new AgentEdit(tx, spaceId).lead(now), now);
        return chat;
      }
      const chat = await chats.lock(spaceId, req.chatId);
      chat.assertSender(deviceId);
      const lead = await this.partnerOf(tx, chat, now);
      const text = { requestId: req.requestId, message: req.message, refs: TaskRefs.of(null) };
      return this.talk(tx, actor, chat, lead, text, now, deviceId);
    });
  }

  /** 대화의 모델 · 생각 강도 (2026-11-15 B). 맡은 대화에만: 강도는 대표의 도구가 받는 것만 */
  async tune(actor: Actor, req: TuneChatInput): Promise<Chat> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const chats = new ChatRepository(tx);
      const chat = await chats.lock(spaceId, req.id);
      chat.assertSender(null);
      chat.assertVersion(req.version);
      const agent = await new AgentRepository(tx).load(spaceId, chat.partnerId);
      chat.tune(req.model, req.effort, agent.tool, new Date());
      await chats.save(chat);
      return chat;
    });
  }

  /** 관리자가 대화를 멈춘다 (2차 2단계): 도는 일(회차 · 덧붙인 말의 답 · 검토와 그 아래)과 기다리는 결재 · 결과 카드를 모두 취소 */
  async stop(actor: Actor, req: VersionInput): Promise<Chat> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const now = new Date();
    return this.transaction(async (tx) => {
      const chat = await new ChatRepository(tx).lock(spaceId, req.id);
      chat.assertVersion(req.version);
      await this.cancelOpen(tx, spaceId, chat.id, now);
      return chat;
    });
  }

  /**
   * 휴지통으로 (2026-11-19 휴지통 A): 멈추기처럼 도는 일 · 기다리는 결재 · 결과 카드를 취소하고 목록에서 뺀다.
   * 이 대화로 보내는 자동화가 있으면 409 (자동화가 휴지통의 대화에 회차를 보내지 않게, 자동화를 먼저 바꾼다)
   */
  async trash(actor: Actor, req: VersionInput): Promise<Chat> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const now = new Date();
    return this.transaction(async (tx) => {
      const chats = new ChatRepository(tx);
      const chat = await chats.lock(spaceId, req.id);
      chat.assertVersion(req.version);
      if (chat.trashed) return chat;
      if (await new ScheduleRepository(tx).boundToChat(spaceId, chat.id))
        throw new Conflict(
          '이 대화로 보내는 자동화가 있어요. 자동화를 바꾼 뒤에 휴지통으로 보내요',
        );
      await this.cancelOpen(tx, spaceId, chat.id, now);
      chat.trash(now);
      await chats.save(chat);
      return chat;
    });
  }

  /** 휴지통에서 꺼낸다. 멈춘 일은 다시 돌지 않는다 (다음 메시지부터 이어서) */
  async restore(actor: Actor, req: VersionInput): Promise<Chat> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const chats = new ChatRepository(tx);
      const chat = await chats.lock(spaceId, req.id);
      chat.assertVersion(req.version);
      if (!chat.trashed) return chat;
      chat.trash(null);
      await chats.save(chat);
      return chat;
    });
  }

  /**
   * 결과 카드를 수정 요청 · 반려한 뒤 (ChatCardHandler): 도는 일을 멈추고, 수정 요청이면 관리자의 메모를 다음 회차로 보낸다.
   * 두 번 불려도 같다 (다음 회차는 카드의 id로 한 번만)
   */
  async closeByCard(actor: Actor, spaceId: string, cardId: string): Promise<void> {
    if (!(actor instanceof SystemActor)) throw new Forbidden('system');
    const now = new Date();
    await this.transaction(async (tx) => {
      const card = await new ApprovalRepository(tx).findIn(spaceId, cardId);
      if (!card?.isCard) return;
      const revise = card.status === Approval.REVISION_REQUESTED;
      if (!revise && card.status !== Approval.REJECTED) return;
      const chat = await new ChatRepository(tx).lock(spaceId, card.targetId);
      await this.cancelOpen(tx, spaceId, chat.id, now);
      if (!revise || !card.note) return;
      const agent = await new AgentRepository(tx).load(spaceId, chat.partnerId);
      const text = { requestId: `card:${card.id}`, message: card.note, refs: TaskRefs.of(null) };
      await this.talk(tx, actor, chat, agent, text, now, null);
    });
  }

  /**
   * 승인 뒤 이어서 (O-2, ChatContinueHandler): 끝난(done) 작업이 대표가 continue로 올린 설정 바꾸기를 승인받아 적용한 일이면
   * 그 대화에 회차 하나를 연다 (지시문 틀 setting-continue, payload.chat.fixBy 'setting'). 적용이 실패했거나(작업 실패)
   * 대화를 멈췄으면(작업 취소) 열지 않는다. 결재마다 한 번 (Idempotency), 두 번 불려도 같다
   */
  async continueAfter(actor: Actor, spaceId: string, taskId: string): Promise<void> {
    if (!(actor instanceof SystemActor)) throw new Forbidden('system');
    const prompts = await this.skills.prompts(actor, spaceId);
    const now = new Date();
    await this.transaction(async (tx) => {
      const chats = new ChatRepository(tx);
      const approval = await new ApprovalRepository(tx).continuedBy(taskId);
      const place = approval ? await chats.placeOf(taskId) : null;
      if (!approval || place?.status !== Task.DONE || place.space_id !== spaceId) return;
      const once = new Idempotency(tx, spaceId, `continue:${approval.id}`, ChatService.CONTINUE);
      if (await once.previous()) return;
      const chat = await chats.lock(spaceId, place.chat_id);
      if (chat.trashed) return;
      const lead = await new AgentRepository(tx).load(spaceId, chat.partnerId);
      const message = prompts.fill('setting-continue', { change: approval.settingLine });
      const previous = await chats.previousTurns(chat, spaceId);
      const note = `승인한 설정 적용 · ${approval.settingLine}`.slice(0, Chat.NOTE_MAX);
      const turn = chat.continueAfter(
        lead,
        ChatHistory.turnOf(place),
        { message, note },
        previous,
        now,
      );
      if (turn) {
        await chats.save(chat);
        await new TaskRepository(tx).insertOnce(turn);
      }
      await once.remember({ chatId: chat.id, taskId: turn?.id ?? null });
    });
  }

  /** 대화의 끝나지 않은 일 · 기다리는 결재 · 결과 카드를 취소한다 (잠그는 순서: 대화 → 작업(위 → 아래) → 결재) */
  private async cancelOpen(tx: Sql, spaceId: string, chatId: string, now: Date): Promise<void> {
    const tasks = new TaskRepository(tx);
    const open = await tasks.lockOpenInChat(spaceId, chatId);
    for (const task of open) {
      task.cancel(now);
      await tasks.save(task);
    }
    const approvals = new ApprovalRepository(tx);
    const pending: (Approval | null)[] = [];
    for (const task of open) pending.push(await approvals.lockPending(task.id));
    pending.push(await approvals.lockOpenCard(chatId));
    for (const approval of pending) {
      if (!approval) continue;
      approval.cancel();
      await approvals.save(approval);
    }
  }

  /** 대표가 맡아 첫 회차를 연다 (새 대화 · O-2 전에 배정을 기다리던 대화) */
  private async start(tx: Sql, chat: Chat, lead: Agent, now: Date): Promise<void> {
    const turn = chat.assign(lead, now);
    await new ChatRepository(tx).save(chat);
    await new TaskRepository(tx).insertOnce(turn);
  }

  /**
   * 대화의 상대 (대표). O-2 전에 배정을 기다리던 대화면 지금 대표가 맡아 맡기 전의 첫 메시지로 첫 회차를 열고,
   * 이번 말은 그 회차에 덧붙인 말이 된다 (talk). version: 관리자가 본 대화의 판 (맡으면 판이 오르니 먼저 본다)
   */
  private async partnerOf(tx: Sql, chat: Chat, now: Date, version?: number): Promise<Agent> {
    if (chat.agentId !== null) return new AgentRepository(tx).load(chat.spaceId, chat.agentId);
    if (version !== undefined) chat.assertVersion(version);
    const lead = await new AgentEdit(tx, chat.spaceId).lead(now);
    await this.start(tx, chat, lead, now);
    return lead;
  }

  /**
   * 맡은 대화에 말한다: 앞 회차가 끝났으면 다음 회차, 아니면 그 회차에 덧붙인 말 (소식 + 상대가 짧게 답하는 작업).
   * 같은 requestId는 한 번만 (회차는 회차의 requestId로, 덧붙인 말은 Idempotency로). version은 관리자가 본 대화의 판
   */
  private async talk(
    tx: Sql,
    actor: Actor,
    chat: Chat,
    agent: Agent,
    { requestId, message, refs }: { requestId: string; message: string; refs: TaskRefs },
    now: Date,
    deviceId: string | null,
    version?: number,
  ): Promise<Chat> {
    const chats = new ChatRepository(tx);
    const previous = await chats.previousTurns(chat, chat.spaceId);
    if (ChatHistory.sentAs(previous.at(-1), requestId)) return chat;
    const once = new Idempotency(tx, actor.id ?? chat.spaceId, requestId, ChatService.APPEND);
    if (await once.previous()) return chat;
    if (version !== undefined) chat.assertVersion(version);
    const current = previous.at(-1);
    const tasks = new TaskRepository(tx);
    if (current && ChatHistory.waiting(current)) {
      if (!refs.empty) throw new RuleViolation(ChatService.REFS_WAIT);
      const appended = await chats.countUpdates(current.id, [ChatUpdates.APPENDED]);
      const reply = chat.appendTo(
        current,
        agent,
        requestId,
        message,
        previous,
        appended,
        now,
        deviceId,
      );
      await chats.save(chat);
      if (reply) await tasks.insertOnce(reply);
      await once.remember({ chatId: chat.id });
      return chat;
    }
    const task = chat.send(agent, requestId, message, previous, now, { deviceId, refs });
    await chats.save(chat);
    await tasks.insertOnce(task);
    return chat;
  }

  /** 고른 참조를 보관함으로 확인하고 사진인 결과물을 적는다 (트랜잭션 밖에서, 관리자만). 없으면 빈 참조 */
  private async refsOf(actor: Actor, picks: readonly RefPick[]): Promise<TaskRefs> {
    if (picks.length === 0) return TaskRefs.of(null);
    const [found, images] = await Promise.all([
      this.library.describe(actor, TaskRefs.idsOf(picks)),
      this.outputs.imageIds(actor, TaskRefs.outputIdsOf(picks)),
    ]);
    return TaskRefs.resolve(picks, found, images);
  }
}
