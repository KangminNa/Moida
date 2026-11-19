import type { MemberRow } from '../community.tables';

/** 회원 자신에게 보이는 자기 정보. writableAt: 가입 대기가 끝나 글 · 댓글을 쓸 수 있는 때 */
export class MemberSelfView {
  constructor(
    private readonly r: Pick<
      MemberRow,
      'id' | 'nickname' | 'joined_at' | 'blocked_until' | 'version'
    >,
    private readonly writableAt: Date,
  ) {}

  toJSON(): object {
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

/**
 * 이 브라우저가 누구인가 (GET /api/community/me). member: 로그인한 회원, joining: 소셜 로그인은 했고 가입 중,
 * csrf: 쓰기 요청의 X-Cairn-CSRF 값 (회원 쿠키 · 가입 표 쿠키가 없으면 null)
 */
export class MemberMeView {
  constructor(
    private readonly member: MemberSelfView | null,
    private readonly joining: boolean,
    private readonly csrf: string | null,
  ) {}

  toJSON(): object {
    return { member: this.member, joining: this.joining, csrf: this.csrf };
  }
}

/** 회원 로그인 버튼들 (회원용 로그인 플러그인) */
export class MemberLoginMethodListView {
  constructor(private readonly methods: readonly (readonly [string, string])[]) {}

  toJSON(): object {
    return { methods: this.methods.map(([method, label]) => ({ method, label })) };
  }
}

/** 로그인 시작: 보낼 주소와 상태 쿠키 값 (컨트롤러가 302로 보낸다) */
export class MemberStartView {
  constructor(
    readonly url: string,
    readonly cookie: string,
  ) {}
}
