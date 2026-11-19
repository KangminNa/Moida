import type {
  AgentRow,
  ApprovalRow,
  ChatRow,
  ChatUpdateRow,
  OutputRow,
  ScheduleRow,
  TaskRow,
} from '../task.tables';

// 대화 묶음의 응답 모양. 웹이 `import type`으로 가져온다. view끼리는 서로 가져오지 못해서(경계 검사) 대화 · 소식을 한 파일에 둔다.
// MCP agent_updates · post_update의 모양은 chat-update.view.ts (O-1에서 나눔: 화면이 쓰지 않는다).
// REST(관리자만)는 camelCase, MCP 도구(agent_updates · post_update, docs/API설계.md 4장)는 snake_case.
// 회차 하나 = 관리자의 메시지(작업의 지시)와 상대의 답(작업의 결과). 결과물 · 기다리는 결재는 그 회차의 작업과 하위 작업의 것.

/** 대화 상대 (말을 걸 수 있는지 화면이 알린다. 막는 것은 서버의 Chat) */
export type ChatPartnerRow = Pick<AgentRow, 'name' | 'status' | 'reports_to' | 'deleted_at'>;
/** 회차 작업 한 줄 + 마지막 진행 기록과 끝나지 않은 하위 작업 수 */
export type ChatTurnTaskRow = TaskRow & { last_event: string | null; open_subtasks: number };
/** 회차(맨 위 작업 root)와 그 아래에서 만든 결과물 */
export type ChatOutputRow = Pick<OutputRow, 'id' | 'name' | 'kind'> & { root: string };
/** 결과 카드에 실린 결과물 (2차 2단계). task_id: 만든 작업 (그 작업의 하네스 검사를 옆에 보인다) */
export type ChatCardOutputRow = Pick<OutputRow, 'id' | 'name' | 'kind' | 'mime' | 'task_id'>;
/** 카드 항목을 낸 작업의 결과 (하네스 검사 result.checks, 검증 고리 V) */
export type ChatCardTaskRow = Pick<TaskRow, 'id' | 'result'>;
/** 검토자 짝의 판정 (검증 고리 V). 만드는 곳은 ChatReview.parse: 읽지 못한 답은 unknown과 글 그대로 */
export type ChatReviewVerdict = {
  verdict: 'pass' | 'fix' | 'reject' | 'unknown';
  summary: string;
  checklist: { item: string; ok: boolean; note: string }[];
  fixes: string[];
  skip: string[];
};
/** 회차(맨 위 작업 root)와 그 아래에서 기다리는 결재 */
export type ChatApprovalRow = Pick<ApprovalRow, 'id'> & { root: string };
/** 소식 한 줄과 남긴 에이전트의 이름 */
export type ChatUpdateLine = ChatUpdateRow & { agent: string | null };
/**
 * 상태판의 대화 한 줄: 상대 이름(맡기 전이면 null), 상태(SQL이 정한다: 맡기 전 routing · asking, 맡은 뒤 마지막 회차로
 * working · waiting_approval · done · failed), 지금 도는 작업 수 (마지막 회차와 그 덧붙인 말의 답 아래 전부)
 */
export type ChatBoardRow = ChatRow & { partner: string | null; state: string; active: number };
/** 이 대화에서 시작해 아직 끝나지 않은 작업 하나 (팀이 동시에 일하는 칸, 2026-11-15) */
export type ChatTeamRow = Pick<
  TaskRow,
  'id' | 'agent_id' | 'title' | 'status' | 'wait_reason' | 'created_at' | 'parent_id'
> & { agent: string | null; last_event: string | null };

/** 참조의 칸 (payload.refs · chats.pending_refs). 서버가 적은 값이지만 내보낼 칸은 여기서 고른다 */
function refsOf(raw: unknown) {
  return (Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []).map((r) => ({
    kind: String(r.kind ?? ''),
    id: typeof r.id === 'string' ? r.id : null,
    title: String(r.title ?? ''),
    private: r.private === true,
    url: typeof r.url === 'string' ? r.url : null,
    browser: r.browser === true,
  }));
}

/**
 * 대화의 토큰 한 묶음 (O-1): 회차(배정은 null) · 일한 에이전트(에이전트 없는 일은 null)마다의 합.
 * 수는 러너가 보고한 실행 기록의 tokens (입력 + 캐시 쓰기 + 출력, 설정 › AI 한도와 같은 수)
 */
export type ChatTokenRow = {
  turn: number | null;
  agent_id: string | null;
  agent: string | null;
  tokens: number | string;
};

/** 합계와 에이전트별 몫 (많은 순) */
function tokensOf(rows: readonly ChatTokenRow[]) {
  const agents = new Map<
    string | null,
    { agentId: string | null; name: string | null; tokens: number }
  >();
  for (const r of rows) {
    const one = agents.get(r.agent_id) ?? { agentId: r.agent_id, name: r.agent, tokens: 0 };
    one.tokens += Number(r.tokens);
    agents.set(r.agent_id, one);
  }
  const list = [...agents.values()].sort((a, b) => b.tokens - a.tokens);
  return { tokens: list.reduce((sum, a) => sum + a.tokens, 0), agents: list };
}

/** 대화 하나 (만들기 · 보내기의 응답, 목록 · 상세의 머리) */
export class ChatView {
  constructor(private readonly row: Readonly<ChatRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      /** 맡은 에이전트. 맡기 전(배정 · 질문 중)이면 null */
      agentId: r.agent_id,
      title: r.title,
      /** 맡기 전에 받은 첫 메시지 (맡으면 첫 회차의 메시지가 되고 null) */
      pending: r.pending ?? null,
      turns: r.turns,
      /** 기기(MCP ask_agent)가 연 대화면 그 기기 (기기 목록의 id). 관리자가 연 대화면 null */
      deviceId: r.device_id ?? null,
      /** 목표 한 줄과 프로젝트(host/owner/repo). 새 대화를 열 때 정한다 */
      goal: r.goal ?? null,
      project: r.project ?? null,
      /** 받을 것 (html · blog · browser · code). null이면 대화 답 */
      deliver: r.deliver ?? null,
      /** 앱 관리에서 연 대화의 앱 (blog 앱 id, 스토어 2단계). 화면이 앱 목록으로 이름을 붙인다 */
      appId: r.app_id ?? null,
      /** 대화의 모델 · 생각 강도 (2026-11-15 B). null이면 상대 에이전트의 설정 */
      model: r.model ?? null,
      effort: r.effort ?? null,
      /** 맡기 전 첫 메시지의 참조 (맡으면 첫 회차로 옮겨져 빈다) */
      pendingRefs: refsOf(r.pending_refs),
      version: r.version,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  }
}

/** 대화 목록 (최근에 보낸 것부터): 맡은 에이전트의 이름과 상태 (routing · asking · working · waiting_approval · done · failed) */
export class ChatListView {
  constructor(
    private readonly rows: readonly ChatBoardRow[],
    /** 대화마다 쓴 토큰 (O-1). 없으면 0 */
    private readonly tokens: ReadonlyMap<string, number> = new Map(),
  ) {}

  toJSON() {
    return {
      chats: this.rows.map((r) => ({
        ...new ChatView(r).toJSON(),
        agentName: r.partner,
        state: r.state,
        active: Number(r.active),
        tokens: this.tokens.get(r.id) ?? 0,
      })),
    };
  }
}

/** 회차 하나: 메시지(작업의 지시)와 답(작업의 결과), 그 아래의 결과물 · 기다리는 결재 */
export class ChatTurnView {
  constructor(
    private readonly t: Readonly<ChatTurnTaskRow>,
    private readonly outputs: readonly ChatOutputRow[],
    private readonly approvals: readonly ChatApprovalRow[],
  ) {}

  toJSON() {
    const t = this.t;
    const result = (t.result ?? {}) as { text?: unknown; error?: unknown };
    const chat = (
      t.payload as {
        chat?: {
          turn?: unknown;
          via?: unknown;
          fix?: unknown;
          fixBy?: unknown;
          note?: unknown;
          deliver?: unknown;
          deliverNote?: unknown;
        };
      } | null
    )?.chat;
    return {
      turn: Number(chat?.turn ?? 0),
      taskId: t.id,
      taskVersion: t.version,
      /** 기기(MCP ask_agent)가 보낸 메시지인가 */
      fromDevice: chat?.via === 'device',
      message: t.instruction,
      status: t.status,
      waitReason: t.wait_reason,
      createdAt: t.created_at.toISOString(),
      finishedAt: t.finished_at?.toISOString() ?? null,
      reply: typeof result.text === 'string' ? result.text : null,
      error: typeof result.error === 'string' ? result.error : null,
      progress: t.last_event,
      openSubtasks: t.open_subtasks,
      /** 이 회차에 넣은 참조 (2026-11-15 B) */
      refs: refsOf((t.payload as { refs?: unknown } | null)?.refs),
      /** 서버가 다시 맡긴 회차 (메시지는 관리자의 글이 아니라 지시문 틀 result-check · result-fix) */
      fix: chat?.fix === true,
      /** 다시 맡긴 까닭: review(검토 반영, 검증 고리 V) · setting(승인 뒤 이어서, O-2), 받을 것이 빠져서면 null */
      fixBy: typeof chat?.fixBy === 'string' ? chat.fixBy : null,
      /** 서버가 연 회차의 화면용 한 줄 (O-3). 관리자의 말이거나 O-3 전 회차면 null */
      note: typeof chat?.note === 'string' ? chat.note : null,
      /** 이번 회차의 받을 것 (대표가 set_deliver로 정함 · 레시피, O-3)과 까닭. 정하지 않았으면 null (대화의 받을 것을 본다) */
      deliver: typeof chat?.deliver === 'string' ? chat.deliver : null,
      deliverNote: typeof chat?.deliverNote === 'string' ? chat.deliverNote : null,
      outputs: this.outputs
        .filter((o) => o.root === t.id)
        .map((o) => ({ id: o.id, name: o.name, kind: o.kind })),
      approvalIds: this.approvals.filter((a) => a.root === t.id).map((a) => a.id),
    };
  }
}

/** 결재에 실린 바뀔 칸 (설정 바꾸기, 2026-11-15 C). approval.view.ts와 같은 모양 (view끼리 가져오지 못한다) */
function changesOf(payload: unknown) {
  const lines = (payload as { changes?: unknown } | null)?.changes;
  return Array.isArray(lines)
    ? (lines as {
        field: string;
        label?: string;
        before: unknown;
        after: unknown;
        grant: boolean;
      }[])
    : null;
}

/** 바꾸는 설정 (agent · goal · notice …, 2026-11-15 D). 설정 바꾸기가 아니면 null */
function settingOf(payload: unknown): string | null {
  const setting = (payload as { setting?: unknown } | null)?.setting;
  return typeof setting === 'string' ? setting : null;
}

/** 작업 결과의 하네스 검사 (러너가 submit_result의 result.checks로 보냈고 서버가 모양을 봤다). 없으면 null */
function checksOf(result: unknown) {
  const checks = (result as { checks?: unknown } | null)?.checks;
  return Array.isArray(checks)
    ? (checks as { name: string; ok: boolean; how: string; retried: boolean }[]).map(
        ({ name, ok, how, retried }) => ({ name, ok, how, retried }),
      )
    : null;
}

/**
 * 기다리는 결과 카드 (2차 2단계): 실린 결재(동작)와 결과물, 받을 것의 검사, 검토자 짝의 의견.
 * 항목은 한 모양이다 (kind: action · output). 결정은 POST /api/approvals/:id/decide { version, decision, note?, picked? }
 */
export class ChatCardView {
  constructor(
    private readonly card: Readonly<ApprovalRow>,
    private readonly actions: readonly ApprovalRow[],
    private readonly outputs: readonly ChatCardOutputRow[],
    /** 항목을 낸 작업들의 결과 (하네스 검사) */
    private readonly tasks: readonly ChatCardTaskRow[],
    private readonly deliver: string | null,
    private readonly check: { passed: boolean; continues: boolean },
    private readonly review: ChatReviewVerdict | null,
    /** 이 카드까지 서버가 다시 맡긴 회차 수: 받을 것이 빠져서 · 검토 반영 (검증 고리 V) */
    private readonly fixed: { deliver: number; review: number },
  ) {}

  private checksFor(taskId: string | null) {
    return checksOf(this.tasks.find((t) => t.id === taskId)?.result ?? null);
  }

  toJSON() {
    const c = this.card;
    return {
      id: c.id,
      version: c.version,
      turn: c.target_version,
      createdAt: c.created_at.toISOString(),
      items: [
        ...this.actions.map((a) => ({
          kind: 'action',
          id: a.id,
          label: a.action,
          action: a.action as string | null,
          targetKind: a.target_kind as string | null,
          targetId: a.target_id as string | null,
          /** 대상의 판 (앱 코드 공개면 버전 번호: 미리 보기 주소) */
          targetVersion: a.target_version as number | null,
          note: a.note,
          mime: null as string | null,
          changes: changesOf(a.payload),
          setting: settingOf(a.payload),
          /** 이 항목을 낸 작업의 하네스 검사 (없으면 null) */
          checks: this.checksFor(a.task_id),
        })),
        ...this.outputs.map((o) => ({
          kind: 'output',
          id: o.id,
          label: o.name,
          action: null as string | null,
          targetKind: null as string | null,
          targetId: null as string | null,
          targetVersion: null as number | null,
          note: null as string | null,
          mime: o.mime as string | null,
          changes: null as ReturnType<typeof changesOf>,
          setting: null as string | null,
          checks: this.checksFor(o.task_id),
        })),
      ],
      /**
       * 받을 것과 검사 (받을 것을 정하지 않았으면 deliver null, passed true). continues: 아직 없지만 카드의 설정 바꾸기를
       * 승인하면 대표가 이어서 낸다 (O-2 continue, 스토어 2-6)
       */
      deliver: this.deliver,
      ...this.check,
      /** 검토자 짝의 판정 (검토하지 않았으면 null, 검증 고리 V) */
      review: this.review,
      /** 서버가 다시 맡긴 회차 수 (받을 것 · 검토 반영) */
      fixed: this.fixed,
    };
  }
}

/** 이 대화에 회차를 쌓는 자동화 (O-3, 대화 레시피의 chat_id). 매일이면 시각 "HH:MM" (at_time) */
export type ChatAutomationRow = Pick<
  ScheduleRow,
  'id' | 'title' | 'enabled' | 'trigger' | 'mode' | 'weekdays' | 'every_hours' | 'next_run_at'
> & { at_time: string | null };

/**
 * 대화 하나와 회차들 (오래된 것부터, 최근 ChatQuery.TURNS개), 상태 · 최근 소식(과정), 결과 카드 (2차 2단계),
 * 이 대화의 자동화 (O-3)
 */
export class ChatDetailView {
  constructor(
    private readonly chat: Readonly<ChatRow>,
    private readonly partner: Readonly<ChatPartnerRow> | null,
    private readonly turns: readonly ChatTurnView[],
    private readonly board: Readonly<ChatBoardRow> | null,
    private readonly news: readonly ChatUpdateLine[],
    private readonly automations: readonly ChatAutomationRow[],
    private readonly card: ChatCardView | null,
    /** 이 대화에서 시작해 아직 끝나지 않은 작업 (오래된 것부터) */
    private readonly team: readonly ChatTeamRow[] = [],
    /** 이 대화의 일이 쓴 토큰 (O-1) */
    private readonly tokens: readonly ChatTokenRow[] = [],
  ) {}

  toJSON() {
    const p = this.partner;
    return {
      chat: new ChatView(this.chat).toJSON(),
      /** 맡은 에이전트 (맡기 전이면 null) */
      partner: p
        ? {
            name: p.name,
            paused: p.status === 'paused',
            topLevel: p.reports_to === null,
            deleted: p.deleted_at !== null,
          }
        : null,
      turns: this.turns.map((t) => t.toJSON()),
      /** routing · asking · working · waiting_approval · done · failed, 지금 도는 작업 수 */
      state: this.board?.state ?? 'done',
      active: Number(this.board?.active ?? 0),
      /** 최근 소식 (오래된 것부터): 과정 · 덧붙인 말 · O-2 전 대화의 질문 · 맡음 (기록) */
      news: this.news.map((r) => ({
        n: Number(r.n),
        kind: r.kind,
        text: r.text,
        agent: r.agent,
        taskId: r.task_id,
        createdAt: r.created_at.toISOString(),
      })),
      /** 이 대화에 회차를 쌓는 자동화 (O-3): 매일 시각(atTime "HH:MM") · 요일(월 1 ~ 일 7) 또는 N시간마다 */
      automations: this.automations.map((a) => ({
        id: a.id,
        title: a.title,
        enabled: a.enabled,
        trigger: a.trigger,
        mode: a.mode,
        atTime: a.at_time,
        weekdays: a.weekdays,
        everyHours: a.every_hours,
        nextRunAt: a.next_run_at?.toISOString() ?? null,
      })),
      /** 기다리는 결과 카드 (없으면 null) */
      card: this.card?.toJSON() ?? null,
      /** 쓴 토큰 (O-1): 대화 전체 · 에이전트별, 회차마다 (배정은 대화 합계에만) */
      usage: {
        ...tokensOf(this.tokens),
        turns: [...new Set(this.tokens.flatMap((r) => (r.turn === null ? [] : [r.turn])))]
          .sort((a, b) => a - b)
          .map((turn) => ({ turn, ...tokensOf(this.tokens.filter((r) => r.turn === turn)) })),
      },
      /** 팀이 동시에 일하는 칸 (2026-11-15): 회차 · 덧붙인 말의 답 · 검토와 그 아래에서 끝나지 않은 작업. parentId로 맡긴 사슬 */
      team: this.team.map((t) => ({
        taskId: t.id,
        agentId: t.agent_id,
        agent: t.agent,
        title: t.title,
        status: t.status,
        waitReason: t.wait_reason,
        parentId: t.parent_id,
        createdAt: t.created_at.toISOString(),
        lastEvent: t.last_event,
      })),
    };
  }
}
