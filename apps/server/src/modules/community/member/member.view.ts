import type { AccountRow, MemberRow } from '../community.tables';

/** 회원 자신에게 보이는 이 앱의 회원 정보. writableAt: 가입 대기가 끝나 글 · 댓글을 쓸 수 있는 때 */
export class MemberSelfView {
  constructor(
    private readonly r: Pick<
      MemberRow,
      'id' | 'nickname' | 'joined_at' | 'blocked_until' | 'version'
    >,
    private readonly writableAt: Date,
  ) {}

  toJSON() {
    const r = this.r;
    return {
      id: r.id,
      nickname: r.nickname,
      joinedAt: r.joined_at.toISOString(),
      writableAt: this.writableAt.toISOString(),
      blockedUntil: r.blocked_until?.toISOString() ?? null,
      version: r.version,
    };
  }
}

/** 계정 자신에게 보이는 자기 정보 (스토어 계정 2026-11-26, 회원 화면의 me와 함께 쓰여 여기 둔다) (비밀번호 해시는 싣지 않는다). 옮겨 온 옛 회원은 아이디나 메일이 null일 수 있다 */
export class AccountSelfView {
  constructor(
    private readonly r: Pick<
      AccountRow,
      | 'id'
      | 'login_id'
      | 'email'
      | 'joined_at'
      | 'terms_version'
      | 'privacy_version'
      | 'news_agreed_at'
      | 'version'
    >,
  ) {}

  /** 계정이 아직 채우지 않은 것 (웹이 내 정보 · 앱 참여 화면에서 묻는다): 아이디 · 메일 · 공통 약관 동의 */
  get needs(): ('loginId' | 'email' | 'terms')[] {
    const r = this.r;
    const needs: ('loginId' | 'email' | 'terms')[] = [];
    if (!r.login_id) needs.push('loginId');
    if (!r.email) needs.push('email');
    if (r.terms_version === null || r.privacy_version === null) needs.push('terms');
    return needs;
  }

  toJSON() {
    const r = this.r;
    return {
      id: r.id,
      loginId: r.login_id,
      email: r.email,
      joinedAt: r.joined_at.toISOString(),
      /** 소식 메일을 받기로 했는가 (2026-11-27, 내 정보에서 바꾼다) */
      newsMail: r.news_agreed_at !== null,
      needs: this.needs,
      version: r.version,
    };
  }
}

/**
 * 이 브라우저가 누구인가 (GET /api/community/me · 가입 · 로그인 · 참여의 답).
 * account: 이 앱 도메인에 로그인한 스토어 계정, member: 그 계정의 이 앱 회원 (참여 전이면 null).
 * csrf: 쓰기 요청의 X-Cairn-CSRF 값 (회원 쿠키가 없으면 null, 가입 · 로그인의 답에서는 null이라 웹이 me를 다시 읽는다)
 */
export class MemberMeView {
  constructor(
    private readonly account: AccountSelfView | null,
    private readonly member: MemberSelfView | null,
    private readonly csrf: string | null,
  ) {}

  toJSON() {
    return {
      account: this.account?.toJSON() ?? null,
      member: this.member?.toJSON() ?? null,
      csrf: this.csrf,
    };
  }
}
