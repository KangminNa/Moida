import type { SessionRow } from '../vault.tables';

// 세션 휴지통의 모양 (2026-11-19 휴지통 A, 관리자만)

/** 휴지통의 세션 한 줄 (관리자만): 되살릴 때 쓸 version과 휴지통에 넣은 때 */
export class SessionTrashLineView {
  constructor(
    private readonly row: Pick<
      SessionRow,
      | 'node_id'
      | 'head_title'
      | 'project'
      | 'tool'
      | 'revision_count'
      | 'last_revision_at'
      | 'version'
    > & { deleted_at: Date },
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.node_id,
      title: r.head_title ?? '',
      project: r.project,
      tool: r.tool,
      revisionCount: r.revision_count,
      lastRevisionAt: r.last_revision_at?.toISOString() ?? null,
      trashedAt: r.deleted_at.toISOString(),
      version: r.version,
    };
  }
}

/** 휴지통의 세션들 (GET /api/sessions/trash, 넣은 때가 늦은 순) */
export class SessionTrashView {
  constructor(private readonly sessions: readonly SessionTrashLineView[]) {}

  toJSON() {
    return { sessions: this.sessions.map((s) => s.toJSON()) };
  }
}

/** 휴지통에 넣거나 꺼낸 뒤의 세션 (trashedAt이 null이면 휴지통 밖) + 남은 변경 묶음 (되돌리기에 쓴다) */
export class SessionTrashedView {
  constructor(
    private readonly row: Pick<SessionRow, 'node_id' | 'version'>,
    private readonly trashedAt: Date | null,
    private readonly changeSetId: string,
  ) {}

  toJSON() {
    return {
      id: this.row.node_id,
      version: this.row.version,
      trashedAt: this.trashedAt?.toISOString() ?? null,
      changeSetId: this.changeSetId,
    };
  }
}
