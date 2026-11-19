import { BaseEntity, Conflict, Forbidden, TableEntity } from '../../platform';
import type { CommentNew, CommentRow, CommentState, DecisionAction } from '../community.tables';
import { Moderation } from '../moderation/moderation.policy';
import { ContentDecidedView } from '../moderation/moderation.view';
import { WriteLimits } from '../topic/write-limits.policy';
import { CommentSavedView } from './comment.view';

// 커뮤니티 댓글 하나 (community.comments, 스토어 3-1b). 보이는 글에만 달고, 고치지 않는다 (1차).
// 쓴 회원이 지우면 상태 deleted이고 내용은 남는다 (원칙 2). 가림 · 내림은 글과 같은 규칙 (Moderation, 3-1c)
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

  /** 관리자가 마지막으로 정한 때. 이보다 앞선 신고는 임시 가림에 세지 않는다 */
  get decidedAt(): Date | null {
    return this.row.decided_at;
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
    this.put('hidden_by', null);
  }

  /** 관리자 결정: 가림 · 되돌림 · 내림 (Moderation.next). 정한 때를 적는다 */
  decide(action: DecisionAction, now: Date): void {
    const [state, by] = Moderation.next(this.row.state, action);
    this.put('state', state);
    this.put('hidden_by', by);
    this.put('decided_at', now);
  }

  /** 신고가 쌓여 시스템이 임시로 가린다. 보이는 댓글만 (아니면 false) */
  hideByReports(): boolean {
    if (this.row.state !== Comment.SHOWN) return false;
    this.put('state', 'hidden');
    this.put('hidden_by', 'reports');
    return true;
  }

  decidedView(): ContentDecidedView {
    return new ContentDecidedView(this.row);
  }

  savedView(): CommentSavedView {
    return new CommentSavedView(this.row);
  }
}
