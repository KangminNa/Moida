import { BaseRequest, type RequestFields } from '../../platform';
import { type RefPick, TaskRefs } from '../task/task-refs.policy';
import { Chat } from './chat';

// 대화 입력의 모양. 뜻(상대가 관리자 바로 아래인지, 덧붙인 말의 한도)은 Chat이 검사한다.

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

/** POST /api/chats { requestId, agentId?, message, goal?, project?, deliver?, refs? }. 대화와 첫 메시지를 함께. 같은 requestId는 처음 만든 대화 */
export class CreateChatInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    /** 상대. 비우면 배정 (ChatRoute: 맡는 일이 맞는 에이전트, 애매하면 대화로 묻는다) */
    readonly agentId: string | null,
    readonly message: string,
    readonly goal: string | null,
    /** git 주소 그대로 (ChatProject가 맞춘다) */
    readonly project: string | null,
    /** 받을 것 (html · blog · browser · code, 비우면 대화 답. ChatResult.deliverOf가 본다) */
    readonly deliver: string | null,
    readonly refs: readonly RefPick[],
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
          body.agentId === undefined || body.agentId === null ? null : f.uuid('agentId'),
          f.text('message', Chat.MESSAGE_MAX),
          f.optionalText('goal', Chat.GOAL_MAX),
          f.optionalText('project', 400),
          f.optionalText('deliver', 20),
          refsOf(f, body),
        ),
    );
  }
}

/**
 * POST /api/chats/:id/messages { requestId, version, message, choice?, refs? }. 같은 requestId는 한 번만 보낸다.
 * choice: 맡기 전의 대화에서 질문의 고를 것 하나 (에이전트 id, 2차 1-5). message는 화면에 보일 말 (고른 이름)
 */
export class SendChatInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly requestId: string,
    readonly version: number,
    readonly message: string,
    readonly choice: string | null,
    /** 이번 회차의 참조 (일하는 중 · 맡기 전에는 받지 않는다) */
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
          body.choice === undefined || body.choice === null ? null : f.uuid('choice'),
          refsOf(f, body),
        ),
    );
  }
}

/** PATCH /api/chats/:id { version, model, effort }: 대화의 모델 · 생각 강도 (2026-11-15 B). 비우면(null · 빈 글) 상대 에이전트의 설정 */
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
 * MCP ask_agent { request_id, message, agent?, chat_id?, goal?, project?, deliver?, choice? }: 기기가 서버 팀에 메시지를 보낸다.
 * chat_id가 없으면 새 대화(agent: 상대의 이름이나 id, 생략하면 배정 · goal · project), 있으면 그 기기가 연 대화에 이어서.
 * choice: 맡기 전의 대화에서 질문의 고를 것 하나 (에이전트 id. 번호 · 이름을 message로 보내도 된다)
 */
export class AskAgentInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly message: string,
    readonly agent: string | null,
    readonly chatId: string | null,
    readonly goal: string | null,
    /** git 주소 그대로 (ChatProject가 맞춘다) */
    readonly project: string | null,
    readonly deliver: string | null,
    readonly choice: string | null,
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
          f.optionalText('agent', 100),
          body.chat_id === undefined || body.chat_id === null ? null : f.uuid('chat_id'),
          f.optionalText('goal', Chat.GOAL_MAX),
          f.optionalText('project', 400),
          f.optionalText('deliver', 20),
          body.choice === undefined || body.choice === null ? null : f.uuid('choice'),
        ),
    );
  }
}
