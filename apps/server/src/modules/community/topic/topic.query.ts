import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, Database, Lookups, MemberActor, NotFound } from '../../platform';
import type { CommentRow, TopicRow } from '../community.tables';
import type { MemberPlace } from '../member/member.input';
import type { TopicIdInput, TopicListInput } from './topic.input';
import { TopicCommentView, TopicLineView, TopicListView, TopicView } from './topic.view';

// 커뮤니티 글 읽기 (스토어 3-1b): 앱의 보이는 글 목록과 글 하나(보이는 댓글과 함께). 누구나 읽는다 (앱 도메인의 공개된 커뮤니티 앱).
// 작성자는 닉네임만, 내 글 · 댓글이면 고치기 · 지우기에 쓸 version을 함께 싣는다. 지우거나 가린 글은 없는 글과 같다 (404)
@Injectable()
export class TopicQuery extends BaseQuery {
  static readonly PAGE = 30;
  /** 글 하나에 함께 싣는 댓글 수 (오래된 것부터) */
  static readonly COMMENTS = 200;
  private static readonly MISSING = '없는 글이에요';

  constructor(
    db: Database,
    private readonly lookups: Lookups,
  ) {
    super(db);
  }

  async list(actor: Actor, place: MemberPlace, req: TopicListInput): Promise<TopicListView> {
    await this.assertCommunity(actor, place);
    const after = req.cursor === null ? this.sql`` : this.sql`AND t.id < ${req.cursor}`;
    const rows = await this.sql<
      (Pick<TopicRow, 'id' | 'title' | 'body' | 'created_at' | 'edited_at'> & {
        nickname: string;
        comments: number;
      })[]
    >`
      SELECT t.id, t.title, left(t.body, 400) AS body, t.created_at, t.edited_at, m.nickname,
        (SELECT count(*) FROM community.comments c WHERE c.topic_id = t.id AND c.state = 'shown') AS comments
      FROM community.topics t JOIN community.members m ON m.id = t.member_id
      WHERE t.app_id = ${place.appId} AND t.state = 'shown' ${after}
      ORDER BY t.id DESC LIMIT ${TopicQuery.PAGE + 1}`;
    const { items, next } = this.pageOf(rows, TopicQuery.PAGE, (last) => last.id);
    return new TopicListView(
      items.map((r) => new TopicLineView(r)),
      next,
    );
  }

  async one(actor: Actor, place: MemberPlace, req: TopicIdInput): Promise<TopicView> {
    await this.assertCommunity(actor, place);
    const topic = await this.shown(place, req.id);
    const me = actor instanceof MemberActor && actor.appId === place.appId ? actor.id : null;
    const comments = await this.sql<
      (Pick<CommentRow, 'id' | 'member_id' | 'body' | 'created_at' | 'version'> & {
        nickname: string;
      })[]
    >`
      SELECT c.id, c.member_id, c.body, c.created_at, c.version, m.nickname
      FROM community.comments c JOIN community.members m ON m.id = c.member_id
      WHERE c.topic_id = ${topic.id} AND c.state = 'shown'
      ORDER BY c.id LIMIT ${TopicQuery.COMMENTS}`;
    return new TopicView(
      topic,
      topic.member_id === me,
      comments.map((c) => new TopicCommentView(c, c.member_id === me)),
    );
  }

  /** 댓글을 달 수 있는 글인가 (CommentService가 트랜잭션 전에): 그 앱의 보이는 글이어야 한다, 아니면 404 */
  async assertOpen(actor: Actor, place: MemberPlace, id: string): Promise<void> {
    await this.assertCommunity(actor, place);
    await this.shown(place, id);
  }

  private async shown(
    place: MemberPlace,
    id: string,
  ): Promise<
    Pick<
      TopicRow,
      'id' | 'member_id' | 'title' | 'body' | 'created_at' | 'edited_at' | 'version'
    > & {
      nickname: string;
    }
  > {
    const [row] = await this.sql<
      (Pick<
        TopicRow,
        'id' | 'member_id' | 'title' | 'body' | 'created_at' | 'edited_at' | 'version'
      > & {
        nickname: string;
      })[]
    >`
      SELECT t.id, t.member_id, t.title, t.body, t.created_at, t.edited_at, t.version, m.nickname
      FROM community.topics t JOIN community.members m ON m.id = t.member_id
      WHERE t.app_id = ${place.appId} AND t.id = ${id} AND t.state = 'shown'`;
    if (!row) throw new NotFound(TopicQuery.MISSING);
    return row;
  }

  private assertCommunity(actor: Actor, place: MemberPlace): Promise<void> {
    return this.lookups.assertVisible('community-app', actor, [place.appId], '없는 주소예요');
  }
}
