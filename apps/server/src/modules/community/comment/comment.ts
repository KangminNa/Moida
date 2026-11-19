import { BaseEntity, Conflict, Forbidden, TableEntity } from '../../platform';
import type { CommentNew, CommentRow, CommentState } from '../community.tables';
import { WriteLimits } from '../topic/write-limits.policy';
import { CommentSavedView } from './comment.view';

// 커뮤니티 댓글 하나 (community.comments, 스토어 3-1b). 보이는 글에만 달고, 고치지 않는다 (1차).
// 쓴 회원이 지우면 상태 deleted이고 내용은 남는다 (원칙 2). 가림 · 내림은 3-1c
export class Comment extends TableEntity<CommentRow, CommentNew> {
  static readonly BODY_MAX = 2_000;
  static readonly SHOWN: CommentState = 'shown';

  static open(
    appId: string,
    topicId: string,
    memberId: string,
    requestId: string,
    body: string,
    now: Date,
  ): Comment {
    WriteLimits.assertText(body, '댓글', Comment.BODY_MAX, WriteLimits.COMMENT_LINKS);
    return new Comment(
      {
        id: BaseEntity.newId(),
        app_id: appId,
        topic_id: topicId,
        member_id: memberId,
        body,
        body_key: WriteLimits.bodyKey(body),
        request_id: requestId,
        created_at: now,
      },
      true,
    );
  }

  static restore(row: CommentRow): Comment {
    return new Comment(row);
  }

  get bodyKey(): string {
    return this.row.body_key;
  }

  /** 쓴 회원만 (아니면 403) */
  assertAuthor(memberId: string): void {
    if (this.row.member_id !== memberId)
      throw new Forbidden('member', '내가 쓴 댓글만 지울 수 있어요');
  }

  /** 쓴 회원이 지운다: 보이거나 가려진 댓글만 */
  deleteByAuthor(): void {
    if (this.row.state !== Comment.SHOWN && this.row.state !== 'hidden')
      throw new Conflict('이미 지웠거나 관리자가 내린 댓글이에요');
    this.put('state', 'deleted');
  }

  savedView(): CommentSavedView {
    return new CommentSavedView(this.row);
  }
}
