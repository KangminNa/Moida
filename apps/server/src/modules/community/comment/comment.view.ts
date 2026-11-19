import type { CommentRow } from '../community.tables';

/** 댓글 쓰기의 답: 쓴 회원 자신에게 */
export class CommentSavedView {
  constructor(
    private readonly r: Pick<CommentRow, 'id' | 'topic_id' | 'body' | 'created_at' | 'version'>,
  ) {}

  toJSON(): object {
    const r = this.r;
    return {
      id: r.id,
      topicId: r.topic_id,
      body: r.body,
      createdAt: r.created_at.toISOString(),
      version: r.version,
    };
  }
}
