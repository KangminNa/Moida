import type { AccountRow } from '../community.tables';

/** 관리자의 정지 · 풀기 뒤의 계정 */
export class AccountSuspendedView {
  constructor(private readonly r: Pick<AccountRow, 'id' | 'suspended_until' | 'version'>) {}

  toJSON() {
    const r = this.r;
    return {
      id: r.id,
      suspendedUntil: r.suspended_until?.toISOString() ?? null,
      version: r.version,
    };
  }
}

/** 관리의 계정 한 줄 (설정 › 회원 계정). apps: 참여 중인 앱 수 */
export class AccountAdminView {
  constructor(
    private readonly r: Pick<
      AccountRow,
      | 'id'
      | 'login_id'
      | 'email'
      | 'joined_at'
      | 'last_seen_at'
      | 'suspended_until'
      | 'left_at'
      | 'version'
    > & { apps: number },
  ) {}

  toJSON() {
    const r = this.r;
    return {
      id: r.id,
      loginId: r.login_id,
      email: r.email,
      joinedAt: r.joined_at.toISOString(),
      lastSeenAt: r.last_seen_at?.toISOString() ?? null,
      suspendedUntil: r.suspended_until?.toISOString() ?? null,
      leftAt: r.left_at?.toISOString() ?? null,
      apps: Number(r.apps),
      version: r.version,
    };
  }
}
