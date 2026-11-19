import { BaseRequest, type RequestFields } from '../../platform';
import { type RefPick, TaskRefs } from '../task/task-refs.policy';
import { Chat } from './chat';

// 대화 입력의 모양. 뜻(상대가 대표인지, 덧붙인 말의 한도)은 Chat이 검사한다.

/**
 * 메시지의 참조 (refs, 2026-11-15 B): [{ kind, id }] (보관함: wiki · session · post · page · output · link)
 * 또는 [{ kind: 'url', url, browser? }] (http · https 주소, browser면 서버 브라우저로 연다). 모양만 보고 뜻은 TaskRefs.resolve가
 */
function refsOf(f: RequestFields, body: Record<string, unknown>): readonly RefPick[] {
  if (body.refs === undefined || body.refs === null) return [];
  const raw = Array.isArray(body.refs) ? (body.refs as Record<string, unknown>[]) : [];
  return f.nestedList('refs', TaskRefs.MAX).map((r, i) => {
    const kind = r.text('kind', 20);
    if (kind === TaskRefs.URL) {
      const url = r.text('url', 2000);
      if (url && !/^https?:\/\//i.test(url)) r.reject('url', 'http · https 주소예요');
      return { kind, id: null, url, browser: raw[i]?.browser === true };
    }
    if (kind && !TaskRefs.KINDS.includes(kind))
      r.reject('kind', `${TaskRefs.KINDS.join(' · ')} · url 중 하나예요`);
    return { kind, id: r.uuid('id'), url: null, browser: false };
  });
}

/**
 * POST /api/chats { requestId, message, goal?, project?, deliver?, refs?, appId? }. 대화와 첫 메시지를 함께. 같은 requestId는 처음 만든 대화.
 * 상대는 늘 대표 (O-2): 예전 화면이 보내는 agentId는 읽지 않는다. appId: 앱 관리에서 연 대화의 앱 (스토어 2단계, 정하면 그대로)
 */
export class CreateChatInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly message: string,
    readonly goal: string | null,
    /** git 주소 그대로 (ChatProject가 맞춘다) */
    readonly project: string | null,
    /** 받을 것 (html · blog · browser · code, 비우면 대화 답. ChatResult.deliverOf가 본다) */
    readonly deliver: string | null,
    readonly refs: readonly RefPick[],
    readonly appId: string | null,
  ) {
    super();
  }

  static from(raw: unknown): CreateChatInput {
    const body = (raw ?? {}) as Record<string, unknown>;
    return BaseRequest.read(
      raw,
      (f) =>
        new CreateChatInput(
          f.text('requestId', 200),
          f.text('message', Chat.MESSAGE_MAX),
          f.optionalText('goal', Chat.GOAL_MAX),
          f.optionalText('project', 400),
          f.optionalText('deliver', 20),
          refsOf(f, body),
          body.appId === undefined || body.appId === null ? null : f.uuid('appId'),
        ),
    );
  }
}

/** GET /api/chats?app=<앱 id>: 그 앱의 대화만 (스토어 2단계). 없으면 모든 대화 */
export class ListChatsInput extends BaseRequest {
  private constructor(readonly appId: string | null) {
    super();
  }

  static from(query: unknown): ListChatsInput {
    const body = (query ?? {}) as Record<string, unknown>;
    return BaseRequest.read(
      body,
      (f) => new ListChatsInput(body.app === undefined || body.app === '' ? null : f.uuid('app')),
    );
  }
}

/** POST /api/chats/:id/messages { requestId, version, message, refs? }. 같은 requestId는 한 번만 보낸다 */
export class SendChatInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly requestId: string,
    readonly version: number,
    readonly message: string,
    /** 이번 회차의 참조 (일하는 중에는 받지 않는다) */
    readonly refs: readonly RefPick[],
  ) {
    super();
  }

  static from(id: string, raw: unknown): SendChatInput {
    const body = (raw ?? {}) as Record<string, unknown>;
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new SendChatInput(
          f.uuid('id'),
          f.text('requestId', 200),
          f.version(),
          f.text('message', Chat.MESSAGE_MAX),
          refsOf(f, body),
        ),
    );
  }
}

/** PATCH /api/chats/:id { version, model, effort }: 대화의 모델 · 생각 강도 (2026-11-15 B). 비우면(null · 빈 글) 대표의 설정 */
export class TuneChatInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly model: string | null,
    readonly effort: string | null,
  ) {
    super();
  }

  static from(id: string, raw: unknown): TuneChatInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new TuneChatInput(
          f.uuid('id'),
          f.version(),
          f.optionalText('model', 80),
          f.optionalText('effort', 20),
        ),
    );
  }
}

/** GET /api/chats/:id */
export class ChatIdInput extends BaseRequest {
  private constructor(readonly id: string) {
    super();
  }

  static from(id: string): ChatIdInput {
    return BaseRequest.read({ id }, (f) => new ChatIdInput(f.uuid('id')));
  }
}

/**
 * MCP ask_agent { request_id, message, chat_id?, goal?, project?, deliver? }: 기기가 서버 팀(대표)에 메시지를 보낸다.
 * chat_id가 없으면 새 대화(goal · project), 있으면 그 기기가 연 대화에 이어서. 예전 스킬이 보내는 agent · choice는 읽지 않는다
 */
export class AskAgentInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly message: string,
    readonly chatId: string | null,
    readonly goal: string | null,
    /** git 주소 그대로 (ChatProject가 맞춘다) */
    readonly project: string | null,
    readonly deliver: string | null,
  ) {
    super();
  }

  static from(raw: unknown): AskAgentInput {
    const body = (raw ?? {}) as Record<string, unknown>;
    return BaseRequest.read(
      raw,
      (f) =>
        new AskAgentInput(
          f.text('request_id', 200),
          f.text('message', Chat.MESSAGE_MAX),
          body.chat_id === undefined || body.chat_id === null ? null : f.uuid('chat_id'),
          f.optionalText('goal', Chat.GOAL_MAX),
          f.optionalText('project', 400),
          f.optionalText('deliver', 20),
        ),
    );
  }
}

/**
 * blog.app_code.added (스토어 1-6b): 앱 코드에 새 버전이 쌓였다. AI 작업(taskId)이 만든 확인 대기(pending) 버전만
 * 결과 카드에 공개 승인으로 싣는다 (ChatResultService.offerAppCode가 대화의 일인지 본다)
 */
export class AppCodeAddedInput extends BaseRequest {
  private constructor(
    readonly appId: string,
    readonly name: string,
    readonly seq: number,
    readonly pending: boolean,
    readonly taskId: string | null,
  ) {
    super();
  }

  static from(data: unknown): AppCodeAddedInput {
    const raw = (data ?? {}) as { taskId?: unknown; pending?: unknown };
    return BaseRequest.read(
      data,
      (f) =>
        new AppCodeAddedInput(
          f.uuid('appId'),
          f.text('name', 200),
          f.integer('seq', 1, 2_147_483_647),
          raw.pending === true,
          typeof raw.taskId === 'string' ? f.uuid('taskId') : null,
        ),
    );
  }

  /** 카드에 실을 버전인가: AI 작업이 만든 확인 대기 버전 */
  get offered(): boolean {
    return this.pending && this.taskId !== null;
  }
}
