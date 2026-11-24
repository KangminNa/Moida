import { ChatSent, Idempotency, RuleViolation, type Sql } from '../../platform';
import type { Agent } from '../agent/agent';
import { AgentRepository } from '../agent/agent.repository';
import { AgentEdit } from '../agent/agent-edit';
import { TaskRepository } from '../task/task.repository';
import { TaskRefs } from '../task/task-refs.policy';
import { Chat } from './chat';
import { ChatRepository } from './chat.repository';
import { ChatHistory } from './chat-history.policy';
import { ChatUpdates } from './chat-update.policy';

/** 대화에 보내는 말 하나: 같은 requestId는 한 번만 */
type Said = { requestId: string; message: string; refs: TaskRefs };

/**
 * 대화에 말하기 한 번을 부르는 쪽의 트랜잭션에서 (AgentEdit과 같은 방식).
 * 관리자의 콘솔(ChatService.send), 기기의 ask_agent, 결과 카드의 수정 요청, 기능 패키지의 대화 입구(텔레그램, 2026-11-23)가
 * 같은 줄을 지난다: 새 대화면 대표가 맡아 첫 회차를 열고, 맡은 대화면 다음 회차나 끝나지 않은 회차에 덧붙인 말.
 */
export class ChatTalk {
  private static readonly APPEND = 'chat_append';
  /** 참조는 새 회차에만 (덧붙인 말은 회차가 아니다) */
  private static readonly REFS_WAIT = '일하는 중에는 참조를 넣지 못해요. 답이 온 뒤에 보내요';

  constructor(private readonly tx: Sql) {}

  /** 대표가 맡아 첫 회차를 연다 (새 대화 · O-2 전에 배정을 기다리던 대화) */
  async start(chat: Chat, lead: Agent, now: Date): Promise<void> {
    const turn = chat.assign(lead, now);
    await new ChatRepository(this.tx).save(chat);
    await new TaskRepository(this.tx).insertOnce(turn);
  }

  /** 새 대화를 열고 대표가 맡는다 */
  async open(chat: Chat, now: Date): Promise<Chat> {
    await this.start(chat, await new AgentEdit(this.tx, chat.spaceId).lead(now), now);
    return chat;
  }

  /**
   * 대화의 상대 (대표). O-2 전에 배정을 기다리던 대화면 지금 대표가 맡아 맡기 전의 첫 메시지로 첫 회차를 열고,
   * 이번 말은 그 회차에 덧붙인 말이 된다 (talk). version: 관리자가 본 대화의 판 (맡으면 판이 오르니 먼저 본다)
   */
  async partnerOf(chat: Chat, now: Date, version?: number): Promise<Agent> {
    if (chat.agentId !== null) return new AgentRepository(this.tx).load(chat.spaceId, chat.agentId);
    if (version !== undefined) chat.assertVersion(version);
    const lead = await new AgentEdit(this.tx, chat.spaceId).lead(now);
    await this.start(chat, lead, now);
    return lead;
  }

  /**
   * 맡은 대화에 말한다: 앞 회차가 끝났으면 다음 회차, 아니면 그 회차에 덧붙인 말 (소식 + 상대가 짧게 답하는 작업).
   * 같은 requestId는 한 번만 (회차는 회차의 requestId로, 덧붙인 말은 Idempotency로, 열쇠는 by).
   * version은 관리자가 본 대화의 판. 덧붙인 말이었으면 appended
   */
  async talk(
    by: string,
    chat: Chat,
    agent: Agent,
    { requestId, message, refs }: Said,
    now: Date,
    deviceId: string | null,
    version?: number,
  ): Promise<{ chat: Chat; appended: boolean }> {
    const chats = new ChatRepository(this.tx);
    const previous = await chats.previousTurns(chat, chat.spaceId);
    if (ChatHistory.sentAs(previous.at(-1), requestId)) return { chat, appended: false };
    const once = new Idempotency(this.tx, by, requestId, ChatTalk.APPEND);
    if (await once.previous()) return { chat, appended: true };
    if (version !== undefined) chat.assertVersion(version);
    const current = previous.at(-1);
    const tasks = new TaskRepository(this.tx);
    if (current && ChatHistory.waiting(current)) {
      if (!refs.empty) throw new RuleViolation(ChatTalk.REFS_WAIT);
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
      return { chat, appended: true };
    }
    const task = chat.send(agent, requestId, message, previous, now, { deviceId, refs });
    await chats.save(chat);
    await tasks.insertOnce(task);
    return { chat, appended: false };
  }

  /**
   * 기능 패키지의 대화 입구 (플러그인 API 0.10, 텔레그램): 관리자가 이어 둔 메신저에서 온 말.
   * chatId가 없거나 그 대화가 없거나 휴지통이면 새 대화를 연다. 같은 requestId는 한 번만 (새 대화도 requestId로)
   */
  async fromPlugin(
    spaceId: string,
    chatId: string | null,
    requestId: string,
    message: string,
    now: Date,
  ): Promise<ChatSent> {
    // 콘솔의 요청 id 모양(UUID)은 관리자가 콘솔에서 보낸 말의 표시다 (OwnerAsk): 패키지는 자기 접두어를 쓴다 (telegram:)
    if (new RegExp(ChatRepository.CONSOLE_REQUEST).test(requestId))
      throw new RuleViolation('기능 패키지의 대화 요청 id는 패키지 이름으로 시작해요');
    const chats = new ChatRepository(this.tx);
    const before = await chats.findByRequest(spaceId, requestId);
    if (before) return new ChatSent(before.id, before.turns, false);
    const found = chatId === null ? null : await chats.lockOrNull(spaceId, chatId);
    if (!found || found.trashed) {
      const chat = await this.open(Chat.open(spaceId, requestId, message, now), now);
      return new ChatSent(chat.id, chat.turns, false);
    }
    const lead = await this.partnerOf(found, now);
    const said = { requestId, message, refs: TaskRefs.of(null) };
    const { chat, appended } = await this.talk(spaceId, found, lead, said, now, null);
    return new ChatSent(chat.id, chat.turns, appended);
  }
}
