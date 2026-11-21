import {
  BaseRequest,
  type ColumnReaders,
  type RequestFields,
  type Unchecked,
} from '../../platform';
import type { ExternalToolRow } from '../task.tables';
import { ExternalTool } from './external-tool';
import { ExternalToolUrl } from './external-tool-url.policy';

// 외부 도구 입력의 모양 (2차 7단계). 뜻(주소 · 머리글 · 이름의 규칙)은 ExternalTool이 검사한다.

/**
 * 주인이 정하는 칸. 칸 하나에 한 줄이다. 보내지 않은 칸은 그대로, 머리글에 null · 빈 글이면 토큰 없는 도구.
 * auth: 로그인 방식 header(토큰) · oauth(로그인, C1). 보내지 않으면 만들 때 header, 고칠 때 그대로
 */
const COLUMNS: ColumnReaders<ExternalToolRow> = {
  title: (f, n) => f.optionalText(n, ExternalTool.TITLE_MAX) ?? undefined,
  url: (f, n) => f.optionalText(n, ExternalToolUrl.MAX) ?? undefined,
  header_name: (f, n) => f.optionalText(n, 40),
  auth: (f, n) => f.optionalText(n, 10) ?? undefined,
};

/** 토큰 칸 (만들기 · 토큰 넣기가 함께 쓴다). 줄바꿈 · 길이는 ExternalTool.secretOf가 본다 */
function secretOf(f: RequestFields, required: boolean): string | null {
  const value = required
    ? f.text('secret', ExternalTool.SECRET_MAX)
    : f.optionalText('secret', ExternalTool.SECRET_MAX);
  return value;
}

/** POST /api/external-tools: 관리자가 더하면 바로 쓴다. 같은 requestId는 처음 만든 것을 돌려준다 */
export class CreateExternalToolInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly name: string,
    readonly fields: Partial<Unchecked<ExternalToolRow>>,
    /** 머리글의 값. 없으면 토큰 없이 (나중에 넣을 수 있다) */
    readonly secret: string | null,
  ) {
    super();
  }

  static from(raw: unknown): CreateExternalToolInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new CreateExternalToolInput(
          f.uuid('requestId'),
          f.text('name', ExternalTool.NAME_MAX),
          {
            title: f.text('title', ExternalTool.TITLE_MAX),
            url: f.text('url', ExternalToolUrl.MAX),
            ...f.columns(COLUMNS),
          },
          secretOf(f, false),
        ),
    );
  }
}

/** PATCH /api/external-tools/:id. 칸 · 켜기(enabled). 본 version을 함께 보낸다 (낙관적 잠금) */
export class UpdateExternalToolInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly changes: Partial<Unchecked<ExternalToolRow>>,
    /** 켜기 · 끄기. 보내지 않으면 그대로 */
    readonly enabled: boolean | null,
  ) {
    super();
  }

  static from(id: string, raw: unknown): UpdateExternalToolInput {
    const sent = typeof raw === 'object' && raw !== null && 'enabled' in raw;
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new UpdateExternalToolInput(
          f.uuid('id'),
          f.version(),
          f.columns(COLUMNS),
          sent ? f.boolean('enabled') : null,
        ),
    );
  }
}

/** POST /api/external-tools/:id/secret: 토큰을 넣거나 바꾼다 */
export class ExternalToolSecretInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly secret: string,
  ) {
    super();
  }

  static from(id: string, raw: unknown): ExternalToolSecretInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) => new ExternalToolSecretInput(f.uuid('id'), f.version(), secretOf(f, true) ?? ''),
    );
  }
}

/** POST /api/external-tools/:id/delete: 지우고 허락한 에이전트에서도 뗀다 */
export class RemoveExternalToolInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }

  static from(id: string, raw: unknown): RemoveExternalToolInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) => new RemoveExternalToolInput(f.uuid('id'), f.version()),
    );
  }
}

/** POST /api/external-tools/:id/check: 연결 확인 (2026-11-15 MCP 1단계) */
export class CheckExternalToolInput extends BaseRequest {
  private constructor(readonly id: string) {
    super();
  }

  static from(id: string): CheckExternalToolInput {
    return BaseRequest.read({ id }, (f) => new CheckExternalToolInput(f.uuid('id')));
  }
}

/** 끝난 작업 (task.task.changed): 커넥터 확인이면 결과를, 에이전트의 일이면 커넥터 사용을 적는다 */
export class ToolTaskInput extends BaseRequest {
  private constructor(readonly taskId: string) {
    super();
  }

  /** 끝난 상태의 변경만 (대기 · 실행 · 기다림은 넘어간다) */
  static carriedBy(data: Readonly<Record<string, unknown>>): boolean {
    return ['done', 'failed', 'cancelled'].includes(String(data.status));
  }

  static from(data: Readonly<Record<string, unknown>>): ToolTaskInput {
    return BaseRequest.read(data, (f) => new ToolTaskInput(f.uuid('taskId')));
  }
}

/** MCP propose_tool: AI가 새 도구를 제안한다. 토큰은 받지 않는다 */
export class ProposeToolInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly name: string,
    readonly fields: Partial<Unchecked<ExternalToolRow>>,
  ) {
    super();
  }

  static from(raw: unknown): ProposeToolInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new ProposeToolInput(f.uuid('request_id'), f.text('name', ExternalTool.NAME_MAX), {
          title: f.text('title', ExternalTool.TITLE_MAX),
          url: f.text('url', ExternalToolUrl.MAX),
          header_name: f.optionalText('header_name', 40),
          note: f.optionalText('note', ExternalTool.NOTE_MAX) ?? '',
        }),
    );
  }
}

/** 결재(task.tool.plug)가 정해진 이벤트 (task.approval.*) */
export class PlugDecisionInput extends BaseRequest {
  private constructor(
    readonly approvalId: string,
    readonly action: string,
    readonly toolId: string,
    readonly targetVersion: number | null,
    readonly agentId: string | null,
  ) {
    super();
  }

  static from(raw: unknown): PlugDecisionInput {
    return BaseRequest.read(raw, (f) => {
      const body = (raw ?? {}) as Record<string, unknown>;
      return new PlugDecisionInput(
        f.uuid('approvalId'),
        f.text('action', 100),
        f.uuid('targetId'),
        f.optionalInteger('targetVersion', 1, Number.MAX_SAFE_INTEGER),
        typeof body.agentId === 'string' ? f.uuid('agentId') : null,
      );
    });
  }
}

/**
 * GET /api/external-tools/oauth/callback: 로그인 서버가 브라우저를 돌려보낸 곳 (C1). 모양이 틀려도 던지지 않는다:
 * 브라우저가 연 주소라 실패도 화면으로 돌려보내고(맞지 않는 state), 관리자인지는 Service가 먼저 본다.
 * code가 없으면 로그인 서버에서 취소 · 거절한 것 (error=access_denied 등)
 */
export class OAuthCallbackInput extends BaseRequest {
  private constructor(
    readonly state: string,
    readonly code: string | null,
    /** RFC 9207: 답한 로그인 서버 (있으면 시작한 서버와 같아야 한다) */
    readonly iss: string | null,
  ) {
    super();
  }

  static from(query: Readonly<Record<string, unknown>>): OAuthCallbackInput {
    const text = (key: string, max: number) => {
      const value = query[key];
      return typeof value === 'string' && value !== '' && value.length <= max ? value : null;
    };
    return new OAuthCallbackInput(text('state', 200) ?? '', text('code', 4000), text('iss', 2000));
  }
}
