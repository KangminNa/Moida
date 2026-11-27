import { createHash, randomBytes } from 'node:crypto';
import { BaseEntity, TableEntity } from '../../platform';
import type { AccountSessionNew, AccountSessionRow } from '../community.tables';

// 스토어 계정의 로그인 한 번 (community.account_sessions, 2026-11-26). 앱 도메인의 cairn_member 쿠키다: Domain 없이 그 도메인에만 실려
// 로그인은 앱 도메인마다 따로다 (같은 계정이어도 앱마다 다시 로그인). 세션은 계정과 그 앱을 가리키고, 앱에 참여하기 전에도 열린다.
// 관리자 로그인(account WebSession · cairn_session)과 쿠키 · 표가 따로다 (원칙 10). 토큰 원문은 만든 순간에만 메모리에 있고 DB에는 해시만
export class AccountSession extends TableEntity<AccountSessionRow, AccountSessionNew> {
  static readonly COOKIE = 'cairn_member';
  /** 로그인 유지: 마지막으로 쓴 날부터 (관리자 로그인과 같다) */
  static readonly DAYS = 30;
  /** 쿠키는 브라우저가 지키는 가장 긴 기간으로 두고, 살아 있는지는 서버의 expires_at이 정한다 */
  static readonly COOKIE_SECONDS = 400 * 86_400;
  /** 마지막 접근(과 끝나는 날)은 이 간격에 한 번만 적는다 */
  static readonly SEEN_MS = 5 * 60_000;

  private constructor(
    row: AccountSessionRow | AccountSessionNew,
    /** 만든 순간에만 있는 원문 (쿠키로 한 번 나간다) */
    readonly token: string | null,
  ) {
    super(row, token !== null);
  }

  /** appId: 로그인한 앱. null이면 공통 앱 도메인에서 앱 없이 연 로그인 (2026-11-27, 그 도메인에서만 통한다) */
  static start(accountId: string, appId: string | null, now: Date): AccountSession {
    const token = randomBytes(32).toString('base64url');
    return new AccountSession(
      {
        id: BaseEntity.newId(),
        account_id: accountId,
        app_id: appId,
        token_hash: AccountSession.hash(token),
        created_at: now,
        expires_at: AccountSession.expiresFrom(now),
      },
      token,
    );
  }

  static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** 이때 썼다면 로그인이 끝나는 때 */
  static expiresFrom(now: Date): Date {
    return new Date(now.getTime() + AccountSession.DAYS * 86_400_000);
  }
}
