import type { ExternalToolRow } from '../task.tables';

// 외부 도구의 읽기 모양 (2차 7단계). 웹이 `import type`으로 가져온다 (객체설계 6장).
// 토큰은 어느 View에도 싣지 않는다: 화면은 있는지(hasSecret)만, 러너는 일을 빌릴 때 JobToolView의 머리글로만 받는다.

/** 관리 화면의 외부 도구 하나. agents는 이 도구를 허락한 에이전트 */
export class ExternalToolView {
  constructor(
    private readonly row: Readonly<ExternalToolRow>,
    private readonly agents: readonly { id: string; name: string }[] = [],
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      name: r.name,
      title: r.title,
      url: r.url,
      /** 토큰을 실을 머리글. null이면 토큰 없는 도구 */
      headerName: r.header_name,
      /** 토큰을 넣었는가 (값은 내보내지 않는다) */
      hasSecret: r.secret !== null,
      /** proposed(AI의 제안, 결재를 기다림) · active · off */
      status: r.status,
      note: r.note,
      proposedBy: r.proposed_by,
      agents: this.agents.map((a) => ({ id: a.id, name: a.name })),
      version: r.version,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  }
}

/** 외부 도구 목록 (몇 개뿐이라 한 쪽에 다 보낸다) */
export class ExternalToolListView {
  constructor(private readonly tools: readonly ExternalToolView[]) {}

  toJSON() {
    return { tools: this.tools.map((t) => t.toJSON()) };
  }
}

/** AI가 제안한 도구 (propose_tool의 답): 이 id · version으로 request_approval(task.tool.plug)을 올린다 */
export class ProposedToolView {
  constructor(private readonly row: Readonly<ExternalToolRow>) {}

  toJSON() {
    return {
      tool_id: this.row.id,
      name: this.row.name,
      version: this.row.version,
      status: this.row.status,
    };
  }
}
