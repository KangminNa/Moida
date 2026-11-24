import type { CommentRow, DecisionRow, MemberRow, ReportRow, TopicRow } from '../community.tables';

// 커뮤니티 관리 화면의 모양 (스토어 3-1c, 관리자만). 회원 쪽 화면과 달리 아이디 · 상태 · 가린 까닭 · 열린 신고 수 · version을 싣는다.
// 비밀번호 해시 · 세션은 어디에도 싣지 않는다. 임시 비밀번호는 초기화한 응답 한 번에만

/** 쓴 회원 (관리자에게는 아이디까지) */
/** 탈퇴한 회원은 아이디를 지워 'left:<id>'만 남는다 (Member.leave, 3-4): 관리 화면에는 아이디 없음(null)으로 */
function loginOf(loginId: string): string | null {
  return loginId.startsWith('left:') ? null : loginId;
}

function author(id: string, nickname: string, loginId: string) {
  return { id, nickname, loginId: loginOf(loginId) };
}

/** 관리자가 정한 뒤의 글 · 댓글 (POST …/decide) */
export class ContentDecidedView {
  constructor(private readonly r: Pick<TopicRow, 'id' | 'state' | 'hidden_by' | 'version'>) {}

  toJSON() {
    const r = this.r;
    return { id: r.id, state: r.state, hiddenBy: r.hidden_by, version: r.version };
  }
}

/** 관리자가 정한 뒤의 회원 (차단 · 풀기) */
export class MemberDecidedView {
  constructor(private readonly r: Pick<MemberRow, 'id' | 'blocked_until' | 'version'>) {}

  toJSON() {
    const r = this.r;
    return { id: r.id, blockedUntil: r.blocked_until?.toISOString() ?? null, version: r.version };
  }
}

/** 비밀번호 초기화의 답: 임시 비밀번호는 이 응답에만 있다 (저장하지 않는다). 관리자가 회원에게 직접 전한다 */
export class MemberResetView {
  constructor(
    private readonly r: Pick<MemberRow, 'id' | 'login_id' | 'version'>,
    private readonly password: string,
  ) {}

  toJSON() {
    const r = this.r;
    return { id: r.id, loginId: r.login_id, password: this.password, version: r.version };
  }
}

/** 관리 목록의 글 한 줄 (모든 상태). openReports: 열린 신고 수, comments: 모든 댓글 수 */
export class AdminTopicLineView {
  constructor(
    private readonly r: Pick<
      TopicRow,
      'id' | 'member_id' | 'title' | 'body' | 'state' | 'hidden_by' | 'created_at' | 'version'
    > & { nickname: string; login_id: string; open_reports: number; comments: number },
  ) {}

  toJSON() {
    const r = this.r;
    return {
      id: r.id,
      title: r.title,
      excerpt: r.body.replace(/\s+/g, ' ').trim().slice(0, 140),
      state: r.state,
      hiddenBy: r.hidden_by,
      author: author(r.member_id, r.nickname, r.login_id),
      openReports: Number(r.open_reports),
      comments: Number(r.comments),
      createdAt: r.created_at.toISOString(),
      version: r.version,
    };
  }
}

/** 관리 화면의 댓글 하나 (모든 상태) */
export class AdminCommentView {
  constructor(
    private readonly r: Pick<
      CommentRow,
      'id' | 'member_id' | 'body' | 'state' | 'hidden_by' | 'created_at' | 'version'
    > & { nickname: string; login_id: string; open_reports: number },
  ) {}

  toJSON() {
    const r = this.r;
    return {
      id: r.id,
      body: r.body,
      state: r.state,
      hiddenBy: r.hidden_by,
      author: author(r.member_id, r.nickname, r.login_id),
      openReports: Number(r.open_reports),
      createdAt: r.created_at.toISOString(),
      version: r.version,
    };
  }
}

/** 관리 화면의 글 하나: 본문 전체와 모든 댓글 (GET …/admin/:appId/topics/:id) */
export class AdminTopicView {
  constructor(
    private readonly r: Pick<
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
    > & { nickname: string; login_id: string; open_reports: number },
    private readonly comments: readonly AdminCommentView[],
  ) {}

  toJSON() {
    const r = this.r;
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      state: r.state,
      hiddenBy: r.hidden_by,
      revisions: r.revisions,
      author: author(r.member_id, r.nickname, r.login_id),
      openReports: Number(r.open_reports),
      createdAt: r.created_at.toISOString(),
      editedAt: r.edited_at?.toISOString() ?? null,
      decidedAt: r.decided_at?.toISOString() ?? null,
      version: r.version,
      comments: this.comments.map((c) => c.toJSON()),
    };
  }
}

/** 신고 하나와 그 대상 (글이면 제목, 댓글이면 그 글의 제목과 댓글 앞부분). target.version으로 바로 정한다 */
export class AdminReportView {
  constructor(
    private readonly r: Pick<
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
    },
  ) {}

  toJSON() {
    const r = this.r;
    return {
      id: r.id,
      reason: r.reason,
      note: r.note,
      state: r.state,
      reporter: { nickname: r.reporter_nickname },
      target: {
        kind: r.comment_id === null ? 'topic' : 'comment',
        id: r.comment_id ?? r.topic_id,
        topicTitle: r.topic_title,
        excerpt: r.excerpt.replace(/\s+/g, ' ').trim().slice(0, 140),
        state: r.target_state,
        version: r.target_version,
        author: author(r.author_id, r.author_nickname, r.author_login_id),
      },
      createdAt: r.created_at.toISOString(),
      closedAt: r.closed_at?.toISOString() ?? null,
    };
  }
}

/** 관리 목록의 회원 한 줄. topics · comments: 쓴 수 (지운 것 포함) */
export class AdminMemberView {
  constructor(
    private readonly r: Pick<
      MemberRow,
      | 'id'
      | 'login_id'
      | 'nickname'
      | 'joined_at'
      | 'last_seen_at'
      | 'blocked_until'
      | 'password_changed_at'
      | 'version'
    > & { topics: number; comments: number },
  ) {}

  toJSON() {
    const r = this.r;
    return {
      id: r.id,
      loginId: loginOf(r.login_id),
      nickname: r.nickname,
      joinedAt: r.joined_at.toISOString(),
      lastSeenAt: r.last_seen_at?.toISOString() ?? null,
      blockedUntil: r.blocked_until?.toISOString() ?? null,
      passwordChangedAt: r.password_changed_at.toISOString(),
      topics: Number(r.topics),
      comments: Number(r.comments),
      version: r.version,
    };
  }
}

/** 결정 기록 한 줄 (추가만 하는 기록). target: 글 제목 · 댓글 앞부분 · 회원 닉네임 */
export class DecisionView {
  constructor(
    private readonly r: Pick<
      DecisionRow,
      'id' | 'topic_id' | 'comment_id' | 'member_id' | 'action' | 'by_kind' | 'note' | 'created_at'
    > & { label: string },
  ) {}

  toJSON() {
    const r = this.r;
    const kind = r.topic_id !== null ? 'topic' : r.comment_id !== null ? 'comment' : 'member';
    return {
      id: r.id,
      action: r.action,
      by: r.by_kind,
      note: r.note,
      target: {
        kind,
        id: r.topic_id ?? r.comment_id ?? r.member_id,
        label: r.label.replace(/\s+/g, ' ').trim().slice(0, 80),
      },
      createdAt: r.created_at.toISOString(),
    };
  }
}

/** 관리 목록 한 쪽 (글 · 신고 · 회원 · 결정 기록, 최근부터 30개). nextCursor: 다음 쪽에 보낼 값, 끝이면 null */
export class AdminPageView<V extends { toJSON(): object }> {
  constructor(
    private readonly items: readonly V[],
    private readonly nextCursor: string | null,
  ) {}

  toJSON() {
    return {
      items: this.items.map((i) => i.toJSON() as ReturnType<V['toJSON']>),
      nextCursor: this.nextCursor,
    };
  }
}
