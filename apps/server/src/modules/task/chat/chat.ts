import {
  BaseEntity,
  Conflict,
  DomainEvent,
  NotFound,
  RuleViolation,
  TableEntity,
} from '../../platform';
import type { Agent } from '../agent/agent';
import { AgentRuntime } from '../agent/agent-runtime.policy';
import { Task } from '../task/task';
import { TaskRefs } from '../task/task-refs.policy';
import type { ChatNew, ChatRow, ChatUpdateKind, ChatUpdateNew, TaskNew } from '../task.tables';
import { ChatView } from './chat.view';
import { ChatHistory, type ChatTurnRow } from './chat-history.policy';
import { ChatRequest } from './chat-request.policy';
import { ChatUpdates } from './chat-update.policy';
import { TurnDeliver } from './turn-deliver.policy';

/** 회차 하나에 더 실을 것 (Chat.send) */
type ChatTurnExtra = {
  deviceId?: string | null;
  fix?: boolean;
  fixBy?: string;
  /** 서버가 연 회차의 화면용 한 줄 (O-3) · 물려받은 받을 것 */
  note?: string;
  deliver?: string | null;
  refs?: TaskRefs;
};

// 대화 하나 (task.chats, 기획서 결정 2026-11-14). 관리자와 바로 아래 에이전트 하나가 채팅처럼 주고받는다.
// 서버 본체에는 AI가 없어서 메시지 하나 = 상대에게 맡기는 작업 하나다 (회차, request_id chat:<대화>:<회차>).
// 이 줄은 머리(상대 · 제목 · 회차 수)만 든다: 메시지는 작업의 지시, 답은 작업의 결과라 두 벌로 두지 않는다.
// 앞 대화는 회차 작업의 payload.chat.history에 자료로 싣는다. read_url의 기준(주인의 글)은 그대로 이번 메시지뿐이다.
// 2차 1-1: 회차가 끝나지 않았을 때 보낸 말은 덧붙인 말이 된다 (appendTo): 소식 한 줄 + 상대가 짧게 답하는 작업 하나.
// O-2 (2026-11-18): 상대는 늘 공간의 대표(Agent.lead). 열고(첫 메시지는 pending) 바로 대표가 맡는다 (assign).
// O-2 전에 배정을 기다리던 대화(pending)는 다음 말에서 대표가 맡는다 (ChatService).
// 대화의 소식(task.chat_updates, 추가만)은 이 엔티티를 거쳐 쌓인다 (ChatRepository.saveParts)
export class Chat extends TableEntity<ChatRow, ChatNew> {
  /** 화면이 대화 목록 · 대화를 다시 읽는다 (받는 모듈은 없다) */
  static readonly CHANGED = 'task.chat.changed';
  /** 회차의 답이 왔다: 알림 (TaskNotices, 2차 1-5) */
  static readonly ANSWERED = 'task.chat.answered';
  static readonly TITLE_MAX = 80;
  /** 서버가 연 회차의 화면용 한 줄 (O-3, payload.chat.note) */
  static readonly NOTE_MAX = 160;
  static readonly MESSAGE_MAX = 8000;
  static readonly GOAL_MAX = 300;
  /** 회차 작업의 제목 (작업 메뉴에서 대화의 일인지 알아보게) */
  private static readonly TASK_TITLE = 60;
  /** 이번에 쌓을 소식 (saveParts가 넣는다) */
  private added: ChatUpdateNew[] = [];

  /**
   * 새 대화: 상대 없이 열고 첫 메시지를 pending에 둔다. 같은 트랜잭션에서 대표가 맡는다 (assign, O-2).
   * opening: device_id(기기 MCP ask_agent가 연 대화면 그 기기), goal(목표 한 줄), project(맞춘 git 주소, ChatProject),
   * deliver(받을 것, ChatResult.deliverOf), pending_refs(첫 메시지의 참조, 2026-11-15 B), app_id(앱 관리에서 연 대화의 앱, 스토어 2단계)
   */
  static open(
    spaceId: string,
    requestId: string,
    message: string,
    now: Date,
    opening: Pick<
      ChatNew,
      'device_id' | 'goal' | 'project' | 'deliver' | 'pending_refs' | 'app_id'
    > = {},
  ): Chat {
    const text = message.trim();
    if (!text) throw new RuleViolation('메시지를 적어요');
    return new Chat(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        agent_id: null,
        pending: text,
        title: ChatHistory.firstLine(text, Chat.TITLE_MAX),
        turns: 0,
        request_id: requestId,
        ...opening,
        goal: opening.goal?.trim() || null,
        created_at: now,
        updated_at: now,
      },
      true,
    );
  }

  static restore(row: ChatRow): Chat {
    return new Chat(row);
  }

  get spaceId(): string {
    return this.row.space_id;
  }

  /** 맡은 에이전트 (대표). 맡기 전(O-2 전에 배정을 기다리던 대화)이면 null */
  get agentId(): string | null {
    return this.row.agent_id;
  }

  /** 맡은 에이전트. 맡기 전이면 RuleViolation (회차 · 카드는 맡은 대화에만 생긴다) */
  get partnerId(): string {
    if (this.row.agent_id === null) throw new RuleViolation('아직 맡은 에이전트가 없어요');
    return this.row.agent_id;
  }

  /** 맡기 전에 받은 첫 메시지 (맡으면 첫 회차가 되고 비워진다) */
  get pending(): string | null {
    return this.row.pending;
  }

  get turns(): number {
    return this.row.turns;
  }

  get goal(): string | null {
    return this.row.goal;
  }

  /** 맡기 전 첫 메시지의 참조 (맡으면 첫 회차로 옮긴다) */
  get pendingRefs(): TaskRefs {
    return TaskRefs.of({ refs: this.row.pending_refs });
  }

  /** 받을 것 (비우면 대화 답) */
  get deliver(): string | null {
    return this.row.deliver;
  }

  /**
   * 보내는 쪽이 이 대화에 말할 수 있는가. 관리자(deviceId null)는 모든 대화에, 기기는 자기가 연 대화에만:
   * 관리자의 대화를 이어 쓰면 앞 대화(비공개일 수 있다)가 그 기기의 회차에 실린다. 남의 대화는 없는 것처럼 (404)
   */
  assertSender(deviceId: string | null): void {
    if (this.trashed || (deviceId !== null && this.row.device_id !== deviceId))
      throw new NotFound('대화를 찾을 수 없어요');
  }

  /** 휴지통에 있는가 (2026-11-19 휴지통 A). 휴지통의 대화에는 보내지 못하고(assertSender) 서버도 회차를 열지 않는다 */
  get trashed(): boolean {
    return this.row.deleted_at !== null;
  }

  /** 휴지통으로 넣거나(now) 꺼낸다(null). 회차 작업 · 결과물 · 소식은 그대로 남는다 (원칙 2) */
  trash(now: Date | null): void {
    this.put('deleted_at', now);
    this.changed();
  }

  /**
   * 메시지 하나 → 상대에게 맡기는 작업 하나 (다음 회차). previous는 앞 회차 작업들 (오래된 것부터).
   * 앞 회차가 끝나지 않았으면 Conflict: 채팅처럼 한 번에 하나씩 주고받는다 (답을 보고 다음 말을 한다).
   * 기기가 보낸 메시지(deviceId)는 관리자가 쓴 글이 아니라 그 기기의 AI가 쓴 글일 수 있다: payload에 via: device를 남겨
   * read_url의 기준(관리자의 지시)에 넣지 않는다 (WebQuery.ownerText)
   */
  send(
    agent: Agent,
    requestId: string,
    message: string,
    previous: readonly ChatTurnRow[],
    now: Date,
    /**
     * deviceId: 기기가 보냈으면, fix: 서버가 다시 맡기는 회차, fixBy: 다시 맡긴 까닭(검토 반영 · 승인 뒤 이어서),
     * note · deliver: 서버가 연 회차의 화면용 한 줄과 앞 회차의 받을 것 (O-3), refs: 이 회차의 참조 (TaskRefs)
     */
    {
      deviceId = null,
      fix = false,
      fixBy,
      note,
      deliver,
      refs = TaskRefs.of(null),
    }: ChatTurnExtra = {},
  ): Task {
    if (agent.id !== this.row.agent_id) throw new RuleViolation('이 대화의 상대가 아니에요');
    Chat.assertPartner(agent);
    refs.assertFor(agent);
    if (ChatHistory.waiting(previous.at(-1)))
      throw new Conflict('답을 기다리는 중이에요. 답이 오거나 취소한 뒤에 보내요');
    const text = message.trim();
    if (!text) throw new RuleViolation('메시지를 적어요');
    const turn = this.row.turns + 1;
    this.put('turns', turn);
    this.put('updated_at', now);
    this.changed();
    return this.task(
      ChatRequest.turn(this.id, turn),
      {
        agent_id: agent.id,
        title: `대화 · ${ChatHistory.firstLine(note ?? text, Chat.TASK_TITLE)}`,
        instruction: text,
        payload: {
          chat: {
            chatId: this.id,
            turn,
            requestId,
            history: ChatHistory.of(previous),
            ...(deviceId === null ? {} : { via: 'device', device: deviceId }),
            ...(fix ? { fix: true, ...(fixBy ? { fixBy } : {}) } : {}),
            ...(note ? { note } : {}),
            ...(deliver ? { deliver } : {}),
            ...(this.row.app_id ? { appId: this.row.app_id } : {}),
          },
          ...refs.payload,
          ...AgentRuntime.turnPayload(agent.tool, this.row.model, this.row.effort),
        },
      },
      now,
    );
  }

  /**
   * 대화의 모델 · 생각 강도 (2026-11-15 B). 비우면 대표의 설정. tool: 대표의 AI 도구 (강도는 그 도구가 받는 것만).
   * 상대의 회차에만 쓴다 (팀원은 각자의 설정)
   */
  tune(model: string | null, effort: string | null, tool: string, now: Date): void {
    const checked = AgentRuntime.effort(effort ?? '');
    AgentRuntime.assertFits(tool, checked);
    this.put('model', AgentRuntime.model(model ?? '') || null);
    this.put('effort', checked || null);
    this.touch(now);
  }

  /**
   * 같은 상대에게 다시 맡긴다 (서버가 연다). 받을 것이 결과에 없으면(2차 2단계, 틀 result-check) 까닭 없이,
   * 검토가 고칠 것을 남겼으면(검증 고리 V, 틀 result-fix) fixBy 'review', 대표가 이어서 하자고 한 설정 바꾸기가 적용되면
   * (O-2, 틀 setting-continue, continueAfter) fixBy 'setting'. message는 그 틀로 채운 글이고
   * 관리자의 글이 아니라서 payload.chat.fix로 표시한다 (화면이 "검사" · "검토 반영" · "승인 뒤 이어서"로 보인다).
   * note는 화면 · 작업 제목에 보일 한 줄(지시문 틀 원문 대신, O-3). 앞 회차의 받을 것을 물려받는다 (TurnDeliver)
   */
  fix(
    agent: Agent,
    message: string,
    previous: readonly ChatTurnRow[],
    now: Date,
    { by, note }: { by?: string; note: string },
  ) {
    const deliver = TurnDeliver.of(previous.at(-1)?.payload);
    const extra = { fix: true, fixBy: by, note, deliver };
    return this.send(agent, `fix:${this.row.turns + 1}`, message, previous, now, extra);
  }

  /**
   * 회차의 결과를 결재 전에 검토자(다른 AI 도구의 에이전트)가 본다 (검토자 짝, 2차 2단계). 회차마다 하나 (request_id).
   * instruction은 지시문 틀 result-review로 채운 글. 답은 소식(review)과 결과 카드에 실린다
   */
  review(reviewer: Agent, instruction: string, now: Date): Task {
    return this.task(
      ChatRequest.review(this.id, this.row.turns),
      {
        agent_id: reviewer.id,
        title: `검토 · ${ChatHistory.firstLine(this.row.title, Chat.TASK_TITLE)}`,
        instruction,
        payload: { chat: { chatId: this.id, turn: this.row.turns, review: true } },
      },
      now,
    );
  }

  /**
   * 끝나지 않은 회차(current)에 덧붙인다: 소식 한 줄, 그리고 회차가 이미 돌고 있으면 대표가 짧게 답하는 작업 하나를 돌려준다
   * (대기열의 회차는 빌릴 때 덧붙인 말을 함께 받으니 따로 답하지 않는다). 회차는 그대로 두어 팀은 하던 일을 계속한다.
   * appended: 이 회차에 이미 덧붙인 수 (회차마다 APPEND_MAX개)
   */
  appendTo(
    current: ChatTurnRow,
    agent: Agent,
    requestId: string,
    message: string,
    previous: readonly ChatTurnRow[],
    appended: number,
    now: Date,
    deviceId: string | null = null,
  ): Task | null {
    if (agent.id !== this.row.agent_id) throw new RuleViolation('이 대화의 상대가 아니에요');
    Chat.assertPartner(agent);
    if (appended >= ChatUpdates.APPEND_MAX)
      throw new RuleViolation(`덧붙인 말은 회차마다 ${ChatUpdates.APPEND_MAX}개까지예요`);
    const text = message.trim();
    if (text.length > ChatUpdates.TEXT_MAX)
      throw new RuleViolation(`덧붙인 말은 ${ChatUpdates.TEXT_MAX}자까지예요`);
    this.note(ChatUpdates.APPENDED, text, current.id, null, now);
    this.put('updated_at', now);
    this.changed();
    if (current.status === Task.QUEUED) return null;
    const turn = this.row.turns;
    return this.task(
      `${ChatRequest.turn(this.id, turn)}:reply:${appended + 1}`,
      {
        agent_id: agent.id,
        title: `대화 · ${ChatHistory.firstLine(text, Chat.TASK_TITLE)}`,
        instruction: text,
        payload: {
          chat: {
            chatId: this.id,
            turn,
            reply: true,
            requestId,
            history: ChatHistory.of(previous),
            ...(deviceId === null ? {} : { via: 'device', device: deviceId }),
          },
        },
      },
      now,
    );
  }

  /**
   * 대표가 맡는다 (O-2): 맡기 전의 첫 메시지로 첫 회차를 연다. 새 대화는 열 때 바로,
   * O-2 전에 배정을 기다리던 대화는 다음 말에서 (그 말은 첫 회차에 덧붙인 말이 된다)
   */
  assign(lead: Agent, now: Date, deliver: string | null = null): Task {
    const message = this.row.pending;
    if (this.row.agent_id !== null || message === null) throw new Conflict('이미 맡은 대화예요');
    Chat.assertPartner(lead);
    const refs = this.pendingRefs;
    this.put('agent_id', lead.id);
    this.put('pending', null);
    this.put('pending_refs', null);
    return this.send(lead, this.row.request_id, message, [], now, {
      deviceId: this.row.device_id,
      refs,
      deliver,
    });
  }

  /**
   * 승인 뒤 이어서 (O-2): 대표가 continue로 올린 설정 바꾸기가 적용되어 turn회차의 일이 끝났다. 그 회차가 아직 마지막이고
   * 도는 회차가 없으면 대표에게 다시 맡긴다 (message는 틀 setting-continue로 채운 글). 아니면 null (관리자가 그사이 다음 말을 했다)
   */
  continueAfter(
    lead: Agent,
    turn: number,
    { message, note }: { message: string; note: string },
    previous: readonly ChatTurnRow[],
    now: Date,
  ): Task | null {
    if (turn !== this.row.turns || ChatHistory.waiting(previous.at(-1))) return null;
    return this.fix(lead, message, previous, now, { by: 'setting', note });
  }

  /** 끝난 작업의 소식 (ChatUpdateService). 회차의 최종 답이면 알림 이벤트도 (답은 앞부분만) */
  settled(kind: ChatUpdateKind, text: string, taskId: string, agentId: string | null, now: Date) {
    this.note(kind, text, taskId, agentId, now);
    if (kind === ChatUpdates.FINAL) this.announce(Chat.ANSWERED, { text: text.slice(0, 300) });
  }

  /** 소식 한 줄을 남긴다 (끝난 작업 · post_update · 덧붙인 말). 저장할 때 함께 쌓인다 */
  note(
    kind: ChatUpdateKind,
    text: string,
    taskId: string | null,
    agentId: string | null,
    now: Date,
  ): void {
    this.added.push(ChatUpdates.line(BaseEntity.newId(), this, kind, text, taskId, agentId, now));
  }

  /** 에이전트가 일하는 도중에 남기는 소식 (MCP post_update). posted: 그 작업이 이미 남긴 수 */
  post(kind: string, text: string, taskId: string, agentId: string, posted: number, now: Date) {
    ChatUpdates.assertPostable(kind, posted);
    this.note(kind, text, taskId, agentId, now);
  }

  /** 저장할 새 소식 (Repository가 부른다) */
  get addedUpdates(): readonly ChatUpdateNew[] {
    return this.added;
  }

  view(): ChatView {
    return new ChatView(this.row);
  }

  /** 대화 상대: 공간의 대표, 멈추지 않은 것 (지운 에이전트는 불러올 때 이미 없다) */
  private static assertPartner(agent: Agent): void {
    if (!agent.lead) throw new RuleViolation(`대표와만 대화해요: ${agent.name}은(는) 팀이에요`);
    if (agent.paused) throw new RuleViolation('대표를 멈췄어요 (설정 › AI에서 다시 시작해요)');
  }

  private touch(now: Date): void {
    this.put('updated_at', now);
    this.changed();
  }

  private announce(name: string, data: Readonly<Record<string, unknown>>): void {
    this.record(
      new DomainEvent(name, 1, this.row.space_id, {
        chatId: this.id,
        title: this.row.title,
        ...data,
      }),
    );
  }

  private changed(): void {
    this.announce(Chat.CHANGED, { turns: this.row.turns });
  }

  /** 대화의 일 하나 (회차 · 덧붙인 말의 답 · 검토): 관리자가 기다리는 일이라 대기열에서 먼저 (ChatRequest.PRIORITY) */
  private task(requestId: string, fields: Omit<TaskNew, 'id' | 'space_id' | 'kind'>, now: Date) {
    const order = { kind: Task.GENERAL, priority: ChatRequest.PRIORITY };
    return Task.open(this.row.space_id, requestId, { ...fields, ...order }, now);
  }
}
