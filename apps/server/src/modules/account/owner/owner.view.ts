import type { UserRow, WebSessionRow } from '../account.tables';

// 주인의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 비밀번호 해시 칸은 읽지도 내보내지도 않는다. 로그인 토큰은 쿠키로만 나간다.

/** 로그인한 주인 (관리 화면 위쪽, 조직도 · 결재에 보일 이름). 주인만 본다 */
export class OwnerView {
  constructor(
    private readonly row: Readonly<Pick<UserRow, 'login' | 'display_name' | 'version'>>,
  ) {}

  toJSON() {
    return {
      login: this.row.login,
      /** 정한 이름. 비어 있으면 null */
      displayName: this.row.display_name,
      /** 화면에 보일 이름: 정한 이름, 없으면 아이디 */
      name: this.row.display_name ?? this.row.login,
      version: this.row.version,
    };
  }
}

/** 로그인됨 (쿠키는 따로 나간다) */
export class LoggedInView {
  toJSON() {
    return { loggedIn: true };
  }
}

/** 로그아웃 */
export class LoggedOutView {
  toJSON() {
    return { loggedOut: true };
  }
}

/** 비밀번호를 바꿈. 다른 기기의 로그인은 끝났다 */
export class PasswordChangedView {
  toJSON() {
    return { changed: true, otherSessionsEnded: true };
  }
}

/** 로그인을 끝냈다 (보안 화면: 하나 또는 다른 곳 모두) */
export class SessionsEndedView {
  toJSON() {
    return { ended: true };
  }
}

/**
 * 끝나지 않은 로그인들 (설정 › 보안, 관리자만). 지금 이 브라우저의 로그인에 current 표시.
 * 로그인 토큰 · 해시는 내보내지 않는다 (해시는 지금 로그인을 알아보는 데만 쓴다).
 * limits: 보안 설정 값 (로그인 유지 날수, 틀린 로그인을 받는 수 · 시간)
 */
export class WebSessionListView {
  constructor(
    private readonly rows: readonly Readonly<WebSessionRow>[],
    private readonly currentHash: string | null,
    private readonly limits: Readonly<
      Record<'sessionDays' | 'triesPerLogin' | 'triesPerPlace' | 'windowSeconds', number>
    >,
  ) {}

  toJSON() {
    return {
      sessions: this.rows.map((r) => ({
        id: r.id,
        current: r.token_hash === this.currentHash,
        createdAt: r.created_at.toISOString(),
        expiresAt: r.expires_at.toISOString(),
        /** 마지막 접근 (5분 단위). 로그인한 뒤 적힌 적이 없으면 null */
        lastSeenAt: r.last_seen_at?.toISOString() ?? null,
        /** 로그인한 곳과 마지막 접근의 곳 */
        ip: r.ip,
        lastIp: r.last_ip,
        userAgent: r.user_agent,
      })),
      limits: { ...this.limits },
    };
  }
}
