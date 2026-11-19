import { createHash, randomBytes } from 'node:crypto';
import { BaseEntity, TableEntity } from '../../platform';
import type { MemberSessionNew, MemberSessionRow } from '../community.tables';

// 회원 로그인 한 번 (community.member_sessions, 스토어 3-1). 앱 도메인의 cairn_member 쿠키다: Domain 없이 그 도메인에만 실린다.
// 관리자 로그인(account WebSession · cairn_session)과 쿠키 · 표가 따로다 (원칙 10). 토큰 원문은 만든 순간에만 메모리에 있고 DB에는 해시만
export class MemberSession extends TableEntity<MemberSessionRow, MemberSessionNew> {
  static readonly COOKIE = 'cairn_member';
  /** 로그인 유지: 마지막으로 쓴 날부터 (관리자 로그인과 같다) */
  static readonly DAYS = 30;
  /** 쿠키는 브라우저가 지키는 가장 긴 기간으로 두고, 살아 있는지는 서버의 expires_at이 정한다 */
  static readonly COOKIE_SECONDS = 400 * 86_400;
  /** 마지막 접근(과 끝나는 날)은 이 간격에 한 번만 적는다 */
  static readonly SEEN_MS = 5 * 60_000;

  private constructor(
    row: MemberSessionRow | MemberSessionNew,
    /** 만든 순간에만 있는 원문 (쿠키로 한 번 나간다) */
    readonly token: string | null,
  ) {
    super(row, token !== null);
  }

  static start(memberId: string, now: Date): MemberSession {
    const token = randomBytes(32).toString('base64url');
    return new MemberSession(
      {
        id: BaseEntity.newId(),
        member_id: memberId,
        token_hash: MemberSession.hash(token),
        created_at: now,
        expires_at: MemberSession.expiresFrom(now),
      },
      token,
    );
  }

  static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** 이때 썼다면 로그인이 끝나는 때 */
  static expiresFrom(now: Date): Date {
    return new Date(now.getTime() + MemberSession.DAYS * 86_400_000);
  }
}
