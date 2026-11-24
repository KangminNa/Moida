import type { MemberRow, ReportRow, TopicRow } from '../community.tables';

/** 검토할 글 · 댓글 한 줄 (댓글이면 든 글의 제목까지) */
export type CaseTarget = Pick<TopicRow, 'id' | 'state' | 'version' | 'created_at' | 'member_id'> & {
  title: string | null;
  body: string;
  topic_id: string | null;
  topic_title: string | null;
};
/** 쓴 회원과 지난 기록 (가린 · 내린 글 · 댓글 수, 차단 결정 수) */
export type CaseAuthor = Pick<
  MemberRow,
  'id' | 'nickname' | 'joined_at' | 'blocked_until' | 'version'
> & { topics: number; comments: number; hidden: number; removed: number; blocks: number };

// 일꾼의 신고 검토 (2026-11-24, 스토어 3-3)가 읽는 모양. 회원의 아이디 · 신고한 회원은 싣지 않는다 (판단에 필요 없는 개인정보).
// 글 · 댓글의 본문은 회원이 쓴 바깥 글이라 자료로만 읽는다 (스킬 cairn-moderate)

/** community_case의 답: 대상 · 쓴 회원 · 신고 (제안에 쓸 대상 id · version 포함) */
export class ReviewCaseView {
  constructor(
    private readonly appId: string,
    private readonly kind: 'topic' | 'comment',
    private readonly target: Readonly<CaseTarget>,
    private readonly author: Readonly<CaseAuthor>,
    private readonly reports: readonly Readonly<
      Pick<ReportRow, 'reason' | 'note' | 'state' | 'created_at'>
    >[],
  ) {}

  toJSON() {
    const t = this.target;
    const a = this.author;
    return {
      app_id: this.appId,
      target: {
        kind: this.kind,
        id: t.id,
        version: t.version,
        state: t.state,
        title: t.title,
        body: t.body,
        created_at: t.created_at.toISOString(),
        topic: t.topic_id ? { id: t.topic_id, title: t.topic_title } : null,
      },
      author: {
        member_id: a.id,
        version: a.version,
        nickname: a.nickname,
        joined_at: a.joined_at.toISOString(),
        blocked_until: a.blocked_until?.toISOString() ?? null,
        topics: a.topics,
        comments: a.comments,
        hidden: a.hidden,
        removed: a.removed,
        blocks: a.blocks,
      },
      reports: this.reports.map((r) => ({
        reason: r.reason,
        note: r.note,
        state: r.state,
        created_at: r.created_at.toISOString(),
      })),
    };
  }
}

/** get_settings moderation: 열린 신고가 있는 대상 (오래된 신고부터) */
export type QueueRow = Pick<ReportRow, 'app_id' | 'topic_id' | 'comment_id'> & {
  open_reports: number;
  first_at: Date;
};

export class ReviewQueueView {
  constructor(private readonly rows: readonly Readonly<QueueRow>[]) {}

  toJSON() {
    return {
      moderation: this.rows.map((r) => ({
        app_id: r.app_id,
        target: r.comment_id === null ? 'topic' : 'comment',
        target_id: r.comment_id ?? r.topic_id,
        open_reports: r.open_reports,
        first_at: r.first_at.toISOString(),
      })),
    };
  }
}
