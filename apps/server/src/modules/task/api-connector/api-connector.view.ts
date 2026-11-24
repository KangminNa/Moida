import type { ApiCallRow, ApiConnectorRow } from '../task.tables';

// API 커넥터의 읽기 모양 (2026-11-24). 웹이 `import type`으로 가져온다 (객체설계 6장).
// 키는 어느 View에도 싣지 않는다: 화면은 머리글마다 넣었는지(keys[].set)만 본다.

type Spec = { base?: string; operations?: Record<string, unknown>[] };

/** 정의서의 동작 요약 (화면 · 결재 카드) */
function operationsOf(spec: unknown) {
  const ops = (spec as Spec | null)?.operations ?? [];
  return ops.map((o) => ({
    name: String(o.name ?? ''),
    title: String(o.title ?? ''),
    /** read(조회) · spend(크레딧을 씀, 하루 한도) · write(바깥에 남김, 부를 때마다 승인) */
    effect: String(o.effect ?? ''),
    method: String(o.method ?? ''),
    path: String(o.path ?? ''),
    /** 입력 칸 이름 (시험의 입력 틀) */
    fields: Object.keys((o.input as Record<string, unknown> | undefined) ?? {}),
  }));
}

/** 관리 화면의 커넥터 하나 */
export class ApiConnectorView {
  constructor(
    private readonly row: Readonly<ApiConnectorRow>,
    private readonly keys: readonly { name: string; set: boolean }[],
    private readonly spent: number,
  ) {}

  toJSON() {
    const r = this.row;
    const pending = r.pending_spec as Spec | null;
    return {
      id: r.id,
      name: r.name,
      title: r.title,
      base: r.base,
      /** proposed(일꾼의 제안, 승인을 기다림) · active · off */
      status: r.status,
      /** 돈이 드는 동작의 하루(최근 24시간) 한도와 쓴 수 */
      dailyMax: r.daily_max,
      spentToday: this.spent,
      /** 키를 싣는 머리글마다 넣었는가 (값은 내보내지 않는다) */
      keys: this.keys,
      operations: operationsOf(r.spec),
      /** 승인을 기다리는 새 버전 (없으면 null) */
      pending: pending ? { base: pending.base ?? '', operations: operationsOf(pending) } : null,
      /** 남겨 둔 앞 버전의 수 */
      history: Array.isArray(r.history) ? r.history.length : 0,
      /** 어디서 찾았는지 { kind: registry · docs · openapi · manual, url } */
      source: r.source as { kind?: string; url?: string | null },
      note: r.note,
      proposedBy: r.proposed_by,
      lastUsedAt: r.last_used_at?.toISOString() ?? null,
      lastError: r.last_error,
      version: r.version,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  }
}

/** 커넥터 목록 */
export class ApiConnectorListView {
  constructor(private readonly items: readonly ApiConnectorView[]) {}

  toJSON() {
    return { connectors: this.items.map((i) => i.toJSON()) };
  }
}

/** 일꾼이 보는 커넥터 하나 (MCP api_tools): 동작마다 입력 칸 */
export class ApiToolView {
  constructor(
    private readonly row: Readonly<ApiConnectorRow>,
    private readonly operations: readonly Record<string, unknown>[],
    private readonly ready: boolean,
    private readonly spent: number,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      connector: r.name,
      title: r.title,
      /** 키가 갖춰져 바로 부를 수 있는가 (아니면 관리자에게 키를 부탁한다) */
      ready: this.ready,
      daily_max: r.daily_max,
      spent_today: this.spent,
      operations: this.operations.map((o) => ({
        name: o.name,
        title: o.title,
        effect: o.effect,
        input: o.input,
        /** 오래 걸려 상태를 다시 묻는다 (api_call로 기다린다) */
        slow: o.poll !== undefined,
        /** 끝나면 파일을 결과물로 받는다 */
        files: o.files !== undefined,
      })),
    };
  }
}

/** 켜진 커넥터 목록 (MCP api_tools) */
export class ApiToolListView {
  constructor(private readonly items: readonly ApiToolView[]) {}

  toJSON() {
    return { connectors: this.items.map((i) => i.toJSON()) };
  }
}

/** 부르기 한 번 (MCP api_run · api_call) */
export class ApiCallView {
  constructor(private readonly row: Readonly<ApiCallRow>) {}

  toJSON() {
    const r = this.row;
    return {
      call_id: r.id,
      operation: r.operation,
      /** held(승인 기다림) · running · polling(상태를 묻는 중) · fetching(파일을 받는 중) · done · failed · refused */
      status: r.status,
      /** 승인을 기다리는 까닭: write(바깥에 남김) · limit(하루 한도를 넘음) */
      held_reason: r.held_reason,
      approval_id: r.approval_id,
      answer: r.answer,
      /** 받은 파일 (결과물 id) */
      output_ids: r.output_ids,
      error: r.error,
      polls: r.polls,
      created_at: r.created_at.toISOString(),
      finished_at: r.finished_at?.toISOString() ?? null,
    };
  }
}

/** 관리 화면의 부르기 한 줄 (커넥터의 최근 부르기 · 시험) */
export class ApiCallLineView {
  constructor(private readonly row: Readonly<ApiCallRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      operation: r.operation,
      effect: r.effect,
      status: r.status,
      heldReason: r.held_reason,
      taskId: r.task_id,
      /** 관리자의 시험이면 true */
      tried: r.task_id === null,
      answer: r.answer,
      outputIds: r.output_ids,
      error: r.error,
      createdAt: r.created_at.toISOString(),
      finishedAt: r.finished_at?.toISOString() ?? null,
    };
  }
}

/** 최근 부르기 목록 */
export class ApiCallListView {
  constructor(private readonly items: readonly ApiCallLineView[]) {}

  toJSON() {
    return { calls: this.items.map((i) => i.toJSON()) };
  }
}

/** propose_api의 답: 올린 결재 (승인되면 켜진다. 키는 관리자가 넣는다) */
export class ProposedApiView {
  constructor(
    private readonly row: Readonly<ApiConnectorRow>,
    private readonly approvalId: string,
  ) {}

  toJSON() {
    return {
      connector_id: this.row.id,
      name: this.row.name,
      status: this.row.status,
      approval_id: this.approvalId,
      note: '관리자가 승인하면 켜져요. 키가 필요한 서비스면 관리자에게 커넥터 화면에서 키를 넣어 달라고 하세요',
    };
  }
}
