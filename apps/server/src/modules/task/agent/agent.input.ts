import {
  BaseRequest,
  type ColumnReaders,
  type RequestFields,
  type Unchecked,
} from '../../platform';
import type { AgentRow } from '../task.tables';

// 에이전트 입력의 모양. 뜻(도구 이름)은 Agent가 검사한다. 권한은 받지 않는다 (2026-11-21: 모든 에이전트가 같은 권한)

const LIMIT_MAX = Number.MAX_SAFE_INTEGER;

/** 주인이 정하는 칸. 칸 하나에 한 줄이다. 보내지 않은 칸은 그대로, 한도에 null을 보내면 한도를 없앤다 */
const COLUMNS: ColumnReaders<AgentRow> = {
  name: (f, n) => f.optionalText(n, 200) ?? undefined,
  role: (f, n) => f.optionalText(n, 4000) ?? '',
  tool: (f, n) => f.optionalText(n, 40) ?? undefined,
  approval_actions: (f, n) => f.optionalTextList(n, 20, 100) ?? undefined,
  monthly_limit: (f, n) => f.optionalInteger(n, 1, LIMIT_MAX),
  five_hour_limit: (f, n) => f.optionalInteger(n, 1, LIMIT_MAX),
  plan_stop_percent: (f, n) => f.optionalInteger(n, 1, 100),
  model: (f, n) => f.optionalText(n, 80) ?? '',
  effort: (f, n) => f.optionalText(n, 10) ?? '',
  external_tools: (f, n) => f.optionalTextList(n, 10, 30) ?? undefined,
};

/** 일을 맡을 러너 칸 (만들기 · 고치기가 함께 쓴다): 보내지 않으면 undefined, null이면 아무 러너 */
function runnerOf(f: RequestFields, raw: unknown): string | null | undefined {
  const body = (raw ?? {}) as Record<string, unknown>;
  if (!('runnerId' in body)) return undefined;
  return body.runnerId === null ? null : f.uuid('runnerId');
}

/** 검토자 짝 · 두 번째 검수자: 칸이 없으면 그대로(undefined), null이면 뺀다 (2차 2단계 · 2026-11-20) */
function reviewerOf(
  f: RequestFields,
  raw: unknown,
  name: 'reviewerId' | 'secondInspectorId' = 'reviewerId',
): string | null | undefined {
  const body = (raw ?? {}) as Record<string, unknown>;
  if (!(name in body)) return undefined;
  return body[name] === null ? null : f.uuid(name);
}

/** 검수 승인 (2026-11-20, 대표만): 칸이 없으면 그대로(undefined) */
function reviewerApprovesOf(f: RequestFields, raw: unknown): boolean | undefined {
  const body = (raw ?? {}) as Record<string, unknown>;
  return 'reviewerApproves' in body ? f.boolean('reviewerApproves') : undefined;
}

/** POST /api/agents. 같은 requestId는 처음 만든 에이전트를 돌려준다 */
export class CreateAgentInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly fields: Partial<Unchecked<AgentRow>>,
    /** 일을 맡을 러너 (task.runners의 id). 없으면 아무 러너 */
    readonly runnerId: string | null,
  ) {
    super();
  }

  /** 이름과 도구는 꼭 있어야 한다. 앞의 세 칸을 먼저 읽어 틀린 칸이 칸 순서대로 모인다 */
  static from(raw: unknown): CreateAgentInput {
    return BaseRequest.read(raw, (f) => {
      const requestId = f.uuid('requestId');
      const name = f.text('name', 200);
      const role = f.optionalText('role', 4000) ?? '';
      const tool = f.text('tool', 40);
      const fields = { ...f.columns(COLUMNS), name, role, tool };
      return new CreateAgentInput(requestId, fields, runnerOf(f, raw) ?? null);
    });
  }
}

/** GET /api/agents?deleted=1: 휴지통의 에이전트만 */
export class ListAgentsInput extends BaseRequest {
  private constructor(readonly deleted: boolean) {
    super();
  }

  static from(raw: unknown): ListAgentsInput {
    return new ListAgentsInput((raw as Record<string, unknown> | null)?.deleted === '1');
  }
}

/** POST /api/agents/:id/delete { version } */
export class DeleteAgentInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }

  static from(id: string, raw: unknown): DeleteAgentInput {
    const body = { ...(raw as object), id } as Record<string, unknown>;
    return BaseRequest.read(body, (f) => new DeleteAgentInput(f.uuid('id'), f.version()));
  }
}

/** PATCH /api/agents/:id. runnerId에 null이면 아무 러너, reviewerId에 null이면 검토자 없음 */
export class UpdateAgentInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly changes: Partial<Unchecked<AgentRow>>,
    readonly runnerId: string | null | undefined,
    readonly reviewerId: string | null | undefined,
    /** 검수 승인: 검토자가 앱 안의 공개를 검수해 통과하면 관리자 대신 승인한다 (대표만, 2026-11-20) */
    readonly reviewerApproves: boolean | undefined,
    /** 두 번째 검수자 (대표만, 2026-11-20, 선택): null이면 뺀다 */
    readonly secondInspectorId: string | null | undefined,
  ) {
    super();
  }

  static from(id: string, raw: unknown): UpdateAgentInput {
    const body = { ...(raw as object), id };
    return BaseRequest.read(
      body,
      (f) =>
        new UpdateAgentInput(
          f.uuid('id'),
          f.version(),
          f.columns(COLUMNS),
          runnerOf(f, body),
          reviewerOf(f, body),
          reviewerApprovesOf(f, body),
          reviewerOf(f, body, 'secondInspectorId'),
        ),
    );
  }
}
