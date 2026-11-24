import type { TermKind, TermRow } from '../community.tables';

/** 공개된 약관 한 버전 (회원 화면 /_/terms · /_/privacy, 관리 화면). 누가 썼는지는 싣지 않는다 */
export class TermView {
  constructor(
    private readonly r: Pick<TermRow, 'kind' | 'version' | 'body' | 'created_at' | 'by_kind'>,
  ) {}

  toJSON() {
    return {
      kind: this.r.kind,
      version: this.r.version,
      body: this.r.body,
      publishedAt: this.r.created_at.toISOString(),
    };
  }

  /** 관리 화면: AI 제안을 승인해 올렸는지까지 */
  adminJSON() {
    return { ...this.toJSON(), approved: this.r.by_kind === 'approved' };
  }
}

/** 관리 화면의 약관 하나: 지금 공개된 버전(없으면 null)과 처음 쓸 때 채울 초안 */
export class TermsAdminLineView {
  constructor(
    private readonly kind: TermKind,
    private readonly current: TermView | null,
    private readonly draft: string,
  ) {}

  toJSON() {
    return {
      kind: this.kind,
      current: this.current?.adminJSON() ?? null,
      draft: this.draft,
    };
  }
}

/** 관리 화면의 약관 둘. ready: 둘 다 공개돼야 회원이 가입할 수 있다 */
export class TermsAdminView {
  constructor(private readonly lines: readonly TermsAdminLineView[]) {}

  toJSON() {
    const items = this.lines.map((l) => l.toJSON());
    return { items, ready: items.every((i) => i.current !== null) };
  }
}

/** get_settings terms: 앱마다 · 종류마다 지금 버전 (본문은 길어 싣지 않는다. 제안은 본문 전체를 새로 쓴다) */
export class TermsSettingView {
  constructor(
    private readonly rows: readonly Pick<TermRow, 'app_id' | 'kind' | 'version' | 'created_at'>[],
  ) {}

  toJSON() {
    return {
      terms: this.rows.map((r) => ({
        app_id: r.app_id,
        kind: r.kind,
        version: r.version,
        published_at: r.created_at.toISOString(),
      })),
    };
  }
}
