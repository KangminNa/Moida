import type { MemberRow } from '../community.tables';

/** 회원 자신에게 보이는 자기 정보 (비밀번호 해시는 싣지 않는다). writableAt: 가입 대기가 끝나 글 · 댓글을 쓸 수 있는 때 */
export class MemberSelfView {
  constructor(
    private readonly r: Pick<
      MemberRow,
      'id' | 'login_id' | 'nickname' | 'joined_at' | 'blocked_until' | 'version'
    >,
    private readonly writableAt: Date,
  ) {}

  toJSON() {
    const r = this.r;
    return {
      id: r.id,
      loginId: r.login_id,
      nickname: r.nickname,
      joinedAt: r.joined_at.toISOString(),
      writableAt: this.writableAt.toISOString(),
      blockedUntil: r.blocked_until?.toISOString() ?? null,
      version: r.version,
    };
  }
}

/** 이 브라우저가 누구인가 (GET /api/community/me). csrf: 쓰기 요청의 X-Cairn-CSRF 값 (로그인하지 않았으면 null) */
export class MemberMeView {
  constructor(
    private readonly member: MemberSelfView | null,
    private readonly csrf: string | null,
  ) {}

  toJSON() {
    return { member: this.member?.toJSON() ?? null, csrf: this.csrf };
  }
}
