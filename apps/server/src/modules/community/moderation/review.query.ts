import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BaseQuery,
  Database,
  Lookups,
  NotFound,
  SettingActor,
  type SettingChangeInput,
} from '../../platform';
import type { MemberRow, ReportRow, TopicRow } from '../community.tables';
import { ModerationChange } from './moderation-change';
import type { ReviewCaseInput } from './review.input';
import {
  type CaseAuthor,
  type CaseTarget,
  type QueueRow,
  ReviewCaseView,
  ReviewQueueView,
} from './review.view';

// 일꾼의 신고 검토 읽기 (2026-11-24, 스토어 3-3). 관리자 읽기(ModerationQuery)와 따로 둔다: 요청자가 일꾼(작업 토큰 · 설정 제안자)이고
// 회원의 아이디 · 신고한 회원을 싣지 않는다. 앱은 Lookups 'member-app'으로 (일꾼에게는 공개했고 도메인 연결을 확인한 앱만)
@Injectable()
export class ReviewQuery extends BaseQuery {
  /** 대상에 함께 싣는 신고 수 (오래된 것부터) */
  static readonly REPORTS = 20;
  /** get_settings moderation의 대상 수 */
  static readonly QUEUE = 30;

  constructor(
    db: Database,
    private readonly lookups: Lookups,
  ) {
    super(db);
  }

  /** community_case: 검토할 글 · 댓글과 쓴 회원 · 신고 */
  async caseOf(actor: Actor, req: ReviewCaseInput): Promise<ReviewCaseView> {
    await this.assertApp(actor, req.appId);
    const comment = req.commentId !== null;
    const id = req.commentId ?? req.topicId ?? '';
    const [target] = comment
      ? await this.sql<CaseTarget[]>`
          SELECT c.id, c.state, c.version, c.created_at, c.member_id, NULL AS title, c.body,
            t.id AS topic_id, t.title AS topic_title
          FROM community.comments c JOIN community.topics t ON t.id = c.topic_id
          WHERE c.app_id = ${req.appId} AND c.id = ${id}`
      : await this.sql<CaseTarget[]>`
          SELECT id, state, version, created_at, member_id, title, body,
            NULL AS topic_id, NULL AS topic_title
          FROM community.topics WHERE app_id = ${req.appId} AND id = ${id}`;
    if (!target) throw new NotFound(comment ? '없는 댓글이에요' : '없는 글이에요');
    const [author] = await this.sql<CaseAuthor[]>`
      SELECT m.id, m.nickname, m.joined_at, m.blocked_until, m.version,
        (SELECT count(*) FROM community.topics t WHERE t.member_id = m.id)::int AS topics,
        (SELECT count(*) FROM community.comments c WHERE c.member_id = m.id)::int AS comments,
        ((SELECT count(*) FROM community.topics t WHERE t.member_id = m.id AND t.state = 'hidden')
          + (SELECT count(*) FROM community.comments c WHERE c.member_id = m.id AND c.state = 'hidden'))::int AS hidden,
        ((SELECT count(*) FROM community.topics t WHERE t.member_id = m.id AND t.state = 'removed')
          + (SELECT count(*) FROM community.comments c WHERE c.member_id = m.id AND c.state = 'removed'))::int AS removed,
        (SELECT count(*) FROM community.decisions d
          WHERE d.member_id = m.id AND d.action = 'block')::int AS blocks
      FROM community.members m WHERE m.id = ${target.member_id}`;
    if (!author) throw new NotFound('쓴 회원을 찾지 못했어요');
    const reports = await this.sql<Pick<ReportRow, 'reason' | 'note' | 'state' | 'created_at'>[]>`
      SELECT reason, note, state, created_at FROM community.reports
      WHERE ${comment ? this.sql`comment_id = ${id}` : this.sql`topic_id = ${id} AND comment_id IS NULL`}
      ORDER BY id LIMIT ${ReviewQuery.REPORTS}`;
    return new ReviewCaseView(req.appId, comment ? 'comment' : 'topic', target, author, reports);
  }

  /** 설정 제안의 지금 값 (바뀐 점 줄의 앞): 글 · 댓글은 상태 · 열린 신고 수, 회원은 차단 끝 */
  async settingNow(
    actor: Actor,
    change: SettingChangeInput,
  ): Promise<Readonly<Record<string, unknown>>> {
    SettingActor.spaceOf(actor);
    const proposed = ModerationChange.of(change);
    await this.assertApp(actor, proposed.appId);
    const { appId, target, targetId } = proposed;
    if (proposed.member) {
      const [member] = await this.sql<Pick<MemberRow, 'blocked_until'>[]>`
        SELECT blocked_until FROM community.members WHERE app_id = ${appId} AND id = ${targetId}`;
      if (!member) throw new NotFound('없는 회원이에요');
      const blocked = ModerationChange.blockedOf(member.blocked_until);
      return { app_id: appId, target, blocked_until: blocked };
    }
    const table = this.sql(target === 'topic' ? 'community.topics' : 'community.comments');
    const column = this.sql(target === 'topic' ? 'topic_id' : 'comment_id');
    const [row] = await this.sql<(Pick<TopicRow, 'state'> & { open_reports: number })[]>`
      SELECT x.state,
        (SELECT count(*) FROM community.reports r
          WHERE r.${column} = x.id AND r.state = 'open')::int AS open_reports
      FROM ${table} x WHERE x.app_id = ${appId} AND x.id = ${targetId}`;
    if (!row) throw new NotFound(target === 'topic' ? '없는 글이에요' : '없는 댓글이에요');
    return { app_id: appId, target, state: row.state, open_reports: row.open_reports };
  }

  /** get_settings moderation: 열린 신고가 있는 글 · 댓글 (보이는 커뮤니티 앱만, 오래된 신고부터) */
  async queue(actor: Actor): Promise<ReviewQueueView> {
    SettingActor.spaceOf(actor);
    const rows = await this.sql<QueueRow[]>`
      SELECT app_id, topic_id, comment_id, count(*)::int AS open_reports, min(created_at) AS first_at
      FROM community.reports WHERE state = 'open'
      GROUP BY app_id, topic_id, comment_id ORDER BY min(created_at) LIMIT ${ReviewQuery.QUEUE}`;
    const apps = [...new Set(rows.map((r) => r.app_id))];
    const visible = await this.lookups.visible('member-app', actor, apps);
    return new ReviewQueueView(rows.filter((r) => visible.has(r.app_id)));
  }

  /** 회원을 받는 앱인가 (아니면 404) */
  private assertApp(actor: Actor, appId: string): Promise<void> {
    return this.lookups.assertVisible('member-app', actor, [appId], '없는 커뮤니티예요');
  }
}
