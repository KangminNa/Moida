import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BaseQuery,
  Database,
  Lookups,
  NotFound,
  RuleViolation,
  ValueList,
} from '../../platform';
import {
  type CommentRow,
  type DecisionRow,
  type MemberRow,
  REPORT_STATE,
  type ReportRow,
  TOPIC_STATE,
  type TopicRow,
} from '../community.tables';
import type { AdminListInput, AdminTopicInput } from './moderation.input';
import {
  AdminCommentView,
  AdminMemberView,
  AdminPageView,
  AdminReportView,
  AdminTopicLineView,
  AdminTopicView,
  DecisionView,
} from './moderation.view';

/** 쓴 회원의 닉네임 · 아이디와 열린 신고 수를 더한 줄 */
type Authored = { nickname: string; login_id: string; open_reports: number };

// 커뮤니티 관리 읽기 (스토어 3-1c): 관리자만, 기본 도메인에서. 앱은 공간의 커뮤니티 앱이어야 한다 (Lookups 'member-app': 커뮤니티 앱과 선언서에 members를 적은 앱, 스토어 12.3).
// 모든 상태(가림 · 내림 · 지움 포함)를 보이고, 쓴 회원의 아이디 · 열린 신고 수 · 정할 때 쓸 version을 싣는다.
// 목록은 최근부터 PAGE개씩, cursor는 앞 쪽의 마지막 id
@Injectable()
export class ModerationQuery extends BaseQuery {
  static readonly PAGE = 30;
  /** 관리 화면의 글 하나에 함께 싣는 댓글 수 (오래된 것부터, 모든 상태) */
  static readonly COMMENTS = 500;

  constructor(
    db: Database,
    private readonly lookups: Lookups,
  ) {
    super(db);
  }

  /** 글 목록 (?state=로 거른다: shown · hidden · removed · deleted, 없으면 모두) */
  async topics(actor: Actor, req: AdminListInput): Promise<AdminPageView<AdminTopicLineView>> {
    await this.assertApp(actor, req.appId);
    const state = ModerationQuery.stateOf(req.state, TOPIC_STATE, null);
    const rows = await this.sql<
      (Pick<
        TopicRow,
        'id' | 'member_id' | 'title' | 'body' | 'state' | 'hidden_by' | 'created_at' | 'version'
      > &
        Authored & { comments: number })[]
    >`
      SELECT t.id, t.member_id, t.title, left(t.body, 400) AS body, t.state, t.hidden_by, t.created_at,
        t.version, m.nickname, m.login_id,
        (SELECT count(*) FROM community.reports r WHERE r.topic_id = t.id AND r.state = 'open') AS open_reports,
        (SELECT count(*) FROM community.comments c WHERE c.topic_id = t.id) AS comments
      FROM community.topics t JOIN community.members m ON m.id = t.member_id
      WHERE t.app_id = ${req.appId} ${state === null ? this.sql`` : this.sql`AND t.state = ${state}`}
        ${this.after('t', req.cursor)}
      ORDER BY t.id DESC LIMIT ${ModerationQuery.PAGE + 1}`;
    return this.page(rows, (r) => new AdminTopicLineView(r));
  }

  /** 글 하나: 본문 전체와 모든 댓글 */
  async topic(actor: Actor, req: AdminTopicInput): Promise<AdminTopicView> {
    await this.assertApp(actor, req.appId);
    const [topic] = await this.sql<
      (Pick<
        TopicRow,
        | 'id'
        | 'member_id'
        | 'title'
        | 'body'
        | 'state'
        | 'hidden_by'
        | 'revisions'
        | 'created_at'
        | 'edited_at'
        | 'decided_at'
        | 'version'
      > &
        Authored)[]
    >`
      SELECT t.id, t.member_id, t.title, t.body, t.state, t.hidden_by, t.revisions, t.created_at,
        t.edited_at, t.decided_at, t.version, m.nickname, m.login_id,
        (SELECT count(*) FROM community.reports r WHERE r.topic_id = t.id AND r.state = 'open') AS open_reports
      FROM community.topics t JOIN community.members m ON m.id = t.member_id
      WHERE t.app_id = ${req.appId} AND t.id = ${req.id}`;
    if (!topic) throw new NotFound('없는 글이에요');
    const comments = await this.sql<
      (Pick<
        CommentRow,
        'id' | 'member_id' | 'body' | 'state' | 'hidden_by' | 'created_at' | 'version'
      > &
        Authored)[]
    >`
      SELECT c.id, c.member_id, c.body, c.state, c.hidden_by, c.created_at, c.version, m.nickname, m.login_id,
        (SELECT count(*) FROM community.reports r WHERE r.comment_id = c.id AND r.state = 'open') AS open_reports
      FROM community.comments c JOIN community.members m ON m.id = c.member_id
      WHERE c.topic_id = ${topic.id} ORDER BY c.id LIMIT ${ModerationQuery.COMMENTS}`;
    return new AdminTopicView(
      topic,
      comments.map((c) => new AdminCommentView(c)),
    );
  }

  /** 신고 목록 (?state=open · accepted · dismissed, 없으면 open)과 그 대상 */
  async reports(actor: Actor, req: AdminListInput): Promise<AdminPageView<AdminReportView>> {
    await this.assertApp(actor, req.appId);
    const state = ModerationQuery.stateOf(req.state, REPORT_STATE, 'open');
    const rows = await this.sql<
      (Pick<
        ReportRow,
        'id' | 'topic_id' | 'comment_id' | 'reason' | 'note' | 'state' | 'created_at' | 'closed_at'
      > & {
        reporter_nickname: string;
        topic_title: string;
        excerpt: string;
        target_state: TopicRow['state'];
        target_version: number;
        author_id: string;
        author_nickname: string;
        author_login_id: string;
      })[]
    >`
      SELECT r.id, r.topic_id, r.comment_id, r.reason, r.note, r.state, r.created_at, r.closed_at,
        rep.nickname AS reporter_nickname,
        coalesce(t.title, ct.title) AS topic_title,
        left(coalesce(c.body, t.body), 400) AS excerpt,
        coalesce(c.state, t.state) AS target_state,
        coalesce(c.version, t.version) AS target_version,
        au.id AS author_id, au.nickname AS author_nickname, au.login_id AS author_login_id
      FROM community.reports r
      JOIN community.members rep ON rep.id = r.member_id
      LEFT JOIN community.topics t ON t.id = r.topic_id
      LEFT JOIN community.comments c ON c.id = r.comment_id
      LEFT JOIN community.topics ct ON ct.id = c.topic_id
      JOIN community.members au ON au.id = coalesce(t.member_id, c.member_id)
      WHERE r.app_id = ${req.appId} AND r.state = ${state} ${this.after('r', req.cursor)}
      ORDER BY r.id DESC LIMIT ${ModerationQuery.PAGE + 1}`;
    return this.page(rows, (r) => new AdminReportView(r));
  }

  /** 회원 목록 (최근 가입부터) */
  async members(actor: Actor, req: AdminListInput): Promise<AdminPageView<AdminMemberView>> {
    await this.assertApp(actor, req.appId);
    const rows = await this.sql<
      (Pick<
        MemberRow,
        | 'id'
        | 'login_id'
        | 'nickname'
        | 'joined_at'
        | 'last_seen_at'
        | 'blocked_until'
        | 'password_changed_at'
        | 'version'
      > & { topics: number; comments: number })[]
    >`
      SELECT m.id, m.login_id, m.nickname, m.joined_at, m.last_seen_at, m.blocked_until,
        m.password_changed_at, m.version,
        (SELECT count(*) FROM community.topics t WHERE t.member_id = m.id) AS topics,
        (SELECT count(*) FROM community.comments c WHERE c.member_id = m.id) AS comments
      FROM community.members m
      WHERE m.app_id = ${req.appId} ${this.after('m', req.cursor)}
      ORDER BY m.id DESC LIMIT ${ModerationQuery.PAGE + 1}`;
    return this.page(rows, (r) => new AdminMemberView(r));
  }

  /** 결정 기록 (최근부터): 신고로 가림 · 관리자의 결정 */
  async decisions(actor: Actor, req: AdminListInput): Promise<AdminPageView<DecisionView>> {
    await this.assertApp(actor, req.appId);
    const rows = await this.sql<
      (Pick<
        DecisionRow,
        | 'id'
        | 'topic_id'
        | 'comment_id'
        | 'member_id'
        | 'action'
        | 'by_kind'
        | 'note'
        | 'created_at'
      > & { label: string })[]
    >`
      SELECT d.id, d.topic_id, d.comment_id, d.member_id, d.action, d.by_kind, d.note, d.created_at,
        coalesce(t.title, left(c.body, 200), m.nickname, '') AS label
      FROM community.decisions d
      LEFT JOIN community.topics t ON t.id = d.topic_id
      LEFT JOIN community.comments c ON c.id = d.comment_id
      LEFT JOIN community.members m ON m.id = d.member_id
      WHERE d.app_id = ${req.appId} ${this.after('d', req.cursor)}
      ORDER BY d.id DESC LIMIT ${ModerationQuery.PAGE + 1}`;
    return this.page(rows, (r) => new DecisionView(r));
  }

  /** 관리자만, 공간의 커뮤니티 앱만 (아니면 404) */
  private async assertApp(actor: Actor, appId: string): Promise<void> {
    actor.assertOwner();
    await this.lookups.assertVisible('member-app', actor, [appId], '없는 커뮤니티예요');
  }

  private after(alias: string, cursor: string | null) {
    return cursor === null ? this.sql`` : this.sql`AND ${this.sql(alias)}.id < ${cursor}`;
  }

  private page<R extends { id: string }, V extends { toJSON(): object }>(
    rows: readonly R[],
    view: (row: R) => V,
  ): AdminPageView<V> {
    const { items, next } = this.pageOf(rows, ModerationQuery.PAGE, (last) => last.id);
    return new AdminPageView(items.map(view), next);
  }

  /** ?state= 값: 값 목록 밖이면 422, 없으면 fallback */
  private static stateOf<S extends string>(
    state: string | null,
    values: readonly S[],
    fallback: S | null,
  ): S | null {
    if (state === null) return fallback;
    if (!ValueList.has(values, state))
      throw new RuleViolation(`state는 ${values.join(' · ')} 가운데 하나예요`);
    return state;
  }
}
