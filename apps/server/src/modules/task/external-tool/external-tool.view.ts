import type { ExternalToolRow } from '../task.tables';

// 외부 도구의 읽기 모양 (2차 7단계). 웹이 `import type`으로 가져온다 (객체설계 6장).
// 토큰은 어느 View에도 싣지 않는다: 화면은 있는지(hasSecret)만, 러너는 일을 빌릴 때 JobToolView의 머리글로만 받는다.
// OAuth 로그인(C1)도 상태만 싣는다 (연결됨 · 끝나는 때 · 로그인 필요 · 실패 까닭 · 로그인 서버). 토큰 · 검증값 · client_id는 싣지 않는다.

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
      /** 로그인 방식 (C1): header(고정 토큰을 머리글에) · oauth(서버가 연 OAuth 로그인) */
      auth: r.auth,
      /** 토큰을 실을 머리글. null이면 토큰 없는 도구 (OAuth면 늘 null) */
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
      /** 러너가 확인한 도구 목록 (2026-11-15 MCP 1단계). 확인하지 않았으면 빈 목록 */
      catalog: Array.isArray(r.catalog)
        ? (r.catalog as { name: string; description: string }[])
        : [],
      /**
       * 도구가 바뀌어 승인을 기다리는 새 목록 (C3, 2026-11-25). 있으면 이 커넥터는 일에 붙지 않는다.
       * 승인할 때 catalogChangedAt을 그대로 보낸다
       */
      catalogPending: Array.isArray(r.catalog_pending)
        ? (r.catalog_pending as { name: string; description: string }[])
        : null,
      catalogChangedAt: r.catalog_changed_at?.toISOString() ?? null,
      /** 마지막 확인 · 실패 까닭 (성공이면 null) */
      checkedAt: r.checked_at?.toISOString() ?? null,
      checkError: r.check_error,
      /** 에이전트의 일에서 마지막으로 부른 때 · 실패 */
      lastUsedAt: r.last_used_at?.toISOString() ?? null,
      lastFailedAt: r.last_failed_at?.toISOString() ?? null,
      lastError: r.last_error,
      /** OAuth 로그인의 상태 (C1). header 방식이면 null */
      oauth: r.auth === 'oauth' ? ExternalToolView.oauth(r) : null,
    };
  }

  private static oauth(r: Readonly<ExternalToolRow>) {
    const issuer = (r.oauth as { issuer?: unknown } | null)?.issuer;
    return {
      /** 로그인해서 토큰을 쥐고 있음 */
      connected: r.token !== null,
      /** 토큰이 없어 관리자가 로그인해야 함 (처음 · 갱신이 거절됨 · 갱신 토큰 없이 끝남) */
      needsLogin: r.token === null,
      /** 접근 토큰이 끝나는 때 (서버가 그 전에 갱신한다). 모르면 null */
      expiresAt: r.token_expires_at?.toISOString() ?? null,
      /** 마지막 로그인 · 갱신 실패 까닭 */
      error: r.oauth_error,
      /** 찾은 로그인 서버 (issuer). 아직 로그인을 시작하지 않았으면 null */
      issuer: typeof issuer === 'string' ? issuer : null,
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

/** OAuth 로그인 시작 (C1): 브라우저가 같은 탭으로 열 로그인 서버의 주소 */
export class OAuthStartView {
  constructor(private readonly url: string) {}

  toJSON() {
    return { url: this.url };
  }
}
