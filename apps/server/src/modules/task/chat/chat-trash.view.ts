import type { ChatRow } from '../task.tables';

// 대화 휴지통의 모양 (2026-11-19 휴지통 A, 관리자만)

/** 휴지통의 대화 한 줄: 되살릴 때 쓸 version과 휴지통에 넣은 때 */
export class ChatTrashLineView {
  constructor(
    private readonly row: Pick<
      ChatRow,
      'id' | 'title' | 'turns' | 'app_id' | 'updated_at' | 'version'
    > & {
      deleted_at: Date;
    },
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      title: r.title,
      turns: r.turns,
      appId: r.app_id,
      updatedAt: r.updated_at.toISOString(),
      trashedAt: r.deleted_at.toISOString(),
      version: r.version,
    };
  }
}

/** 휴지통의 대화들 (GET /api/chats/trash, 넣은 때가 늦은 순) */
export class ChatTrashView {
  constructor(private readonly chats: readonly ChatTrashLineView[]) {}

  toJSON() {
    return { chats: this.chats.map((c) => c.toJSON()) };
  }
}
