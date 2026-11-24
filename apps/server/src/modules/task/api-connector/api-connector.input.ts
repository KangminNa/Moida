import { BaseRequest, type ColumnReaders, type Unchecked } from '../../platform';
import type { ApiConnectorRow } from '../task.tables';
import type { ApiSource } from './api-connector';

// API 커넥터 입력의 모양 (2026-11-24). 뜻(정의서 · 이름 · 키의 규칙)은 ApiSpec · ApiConnector가 본다.

/** 관리자가 고치는 칸 */
const COLUMNS: ColumnReaders<ApiConnectorRow> = {
  title: (f, n) => f.optionalText(n, 60) ?? undefined,
  daily_max: (f, n) => f.optionalInteger(n, 0, 1000) ?? undefined,
};

/** MCP propose_api: 정의서와 찾은 곳. 같은 이름의 커넥터가 있으면 그 커넥터의 새 버전 */
export class ProposeApiInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly name: string,
    readonly title: string,
    readonly note: string,
    readonly source: ApiSource,
    readonly spec: Readonly<Record<string, unknown>>,
  ) {
    super();
  }

  static from(raw: unknown): ProposeApiInput {
    return BaseRequest.read(raw, (f) => {
      const source = f.nested('source');
      return new ProposeApiInput(
        f.uuid('request_id'),
        f.text('name', 30),
        f.text('title', 60),
        f.optionalText('note', 1000) ?? '',
        { kind: source.text('kind', 20), url: source.optionalText('url', 500) },
        f.optionalRecord('spec'),
      );
    });
  }
}

/** MCP api_run: 켜진 커넥터의 동작 하나를 부른다 */
export class ApiRunInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly connector: string,
    readonly operation: string,
    readonly input: Readonly<Record<string, unknown>>,
  ) {
    super();
  }

  static from(raw: unknown): ApiRunInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new ApiRunInput(
          f.uuid('request_id'),
          f.text('connector', 30),
          f.text('operation', 40),
          f.optionalRecord('input'),
        ),
    );
  }
}

/** POST /api/api-connectors/:id/try: 관리자의 시험 (관리자가 누른 것이 승인이다) */
export class TryApiInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly requestId: string,
    readonly operation: string,
    readonly input: Readonly<Record<string, unknown>>,
  ) {
    super();
  }

  static from(id: string, raw: unknown): TryApiInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new TryApiInput(
          f.uuid('id'),
          f.uuid('requestId'),
          f.text('operation', 40),
          f.optionalRecord('input'),
        ),
    );
  }
}

/** MCP api_call: 부르기 하나의 지금 상태. wait_seconds까지 바뀌기를 기다린다 */
export class ApiCallInput extends BaseRequest {
  static readonly WAIT_MAX = 30;

  private constructor(
    readonly callId: string,
    readonly waitSeconds: number,
  ) {
    super();
  }

  static from(raw: unknown): ApiCallInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new ApiCallInput(
          f.uuid('call_id'),
          f.optionalInteger('wait_seconds', 0, ApiCallInput.WAIT_MAX) ?? 0,
        ),
    );
  }
}

/** PATCH /api/api-connectors/:id: 이름표 · 하루 한도 · 켜기. 본 version을 함께 보낸다 */
export class UpdateApiConnectorInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly changes: Partial<Unchecked<ApiConnectorRow>>,
    readonly enabled: boolean | null,
  ) {
    super();
  }

  static from(id: string, raw: unknown): UpdateApiConnectorInput {
    const sent = typeof raw === 'object' && raw !== null && 'enabled' in raw;
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new UpdateApiConnectorInput(
          f.uuid('id'),
          f.version(),
          f.columns(COLUMNS),
          sent ? f.boolean('enabled') : null,
        ),
    );
  }
}

/** PUT /api/api-connectors/:id/keys: 머리글 이름 → 키. 넣은 것만 바꾼다 */
export class ApiKeysInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly keys: Readonly<Record<string, string>>,
  ) {
    super();
  }

  static from(id: string, raw: unknown): ApiKeysInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new ApiKeysInput(f.uuid('id'), f.version(), Object.fromEntries(f.textMap('keys', 4000))),
    );
  }
}

/** 결재(task.api.plug · task.api.call)가 정해진 이벤트 (task.approval.*) */
export class ApiDecisionInput extends BaseRequest {
  private constructor(
    readonly approvalId: string,
    readonly action: string,
    readonly targetId: string,
    readonly targetVersion: number | null,
  ) {
    super();
  }

  static from(raw: unknown): ApiDecisionInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new ApiDecisionInput(
          f.uuid('approvalId'),
          f.text('action', 100),
          f.uuid('targetId'),
          f.optionalInteger('targetVersion', 0, Number.MAX_SAFE_INTEGER),
        ),
    );
  }
}
