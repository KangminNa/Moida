import { type Row, TableRepository } from '../../platform';
import { comments } from '../community.schema';
import type { CommentRow } from '../community.tables';
import { Comment } from './comment';

// community.comments ↔ Comment. load · lock의 첫 값은 앱 id다. 쓰기 한도는 쓴 회원의 행을 잠근 트랜잭션 안에서 센다
export class CommentRepository extends TableRepository<CommentRow, Comment> {
  protected readonly table = comments;
  protected readonly noun = '댓글';

  protected toEntity(row: CommentRow): Comment {
    return Comment.restore(row);
  }

  protected override select(appId: string, id: string, lock: boolean): Promise<readonly Row[]> {
    return this.rows(comments, { id, app_id: appId }, { lock });
  }

  findByRequest(memberId: string, requestId: string): Promise<Comment | null> {
    return this.findOne({ member_id: memberId, request_id: requestId });
  }

  /** 이 회원이 since 뒤에 쓴 댓글 수 (지운 댓글도 센다) */
  async countSince(memberId: string, since: Date): Promise<number> {
    const [row] = await this.sql<{ n: string }[]>`
      SELECT count(*) AS n FROM community.comments WHERE member_id = ${memberId} AND created_at > ${since}`;
    return Number(row?.n ?? 0);
  }

  /** 이 회원이 since 뒤에 같은 본문의 댓글을 같은 글에 올렸는가 */
  async repeated(
    memberId: string,
    topicId: string,
    bodyKey: string,
    since: Date,
  ): Promise<boolean> {
    const rows = await this.sql<{ one: number }[]>`
      SELECT 1 AS one FROM community.comments
      WHERE member_id = ${memberId} AND topic_id = ${topicId} AND body_key = ${bodyKey}
        AND created_at > ${since} LIMIT 1`;
    return rows.length > 0;
  }
}
