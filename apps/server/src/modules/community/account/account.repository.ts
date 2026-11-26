import { Conflict, Database, type Row, TableRepository } from '../../platform';
import { accountSessions, accounts, members } from '../community.schema';
import type { AccountRow } from '../community.tables';
import { Account } from './account';
import { AccountSession } from './account-session';

// community.accounts ↔ Account (+ 로그인할 때의 세션 · 비밀번호를 바꾸거나 정지 · 탈퇴할 때 세션 끝내기).
// 계정은 공간(스토어)에 든다: load · lock의 첫 값은 공간 id다. 메일 · 아이디가 겹치면 DB가 막고 409로 바꾼다
export class AccountRepository extends TableRepository<AccountRow, Account> {
  protected readonly table = accounts;
  protected readonly noun = '계정';

  protected toEntity(row: AccountRow): Account {
    return Account.restore(row);
  }

  protected override select(spaceId: string, id: string, lock: boolean): Promise<readonly Row[]> {
    return this.rows(accounts, { id, space_id: spaceId }, { lock });
  }

  override async save(account: Account): Promise<void> {
    try {
      await super.save(account);
    } catch (error) {
      if (Database.isUniqueViolation(error, 'accounts_email_key'))
        throw new Conflict('이미 가입한 메일이에요');
      if (Database.isUniqueViolation(error, 'accounts_login_key'))
        throw new Conflict('이미 쓰는 아이디예요');
      throw error;
    }
  }

  protected override async saveParts(account: Account): Promise<void> {
    // 비밀번호를 바꾸면 지금 로그인 말고, 다시 정하기 · 초기화 · 정지 · 탈퇴면 모두 끝낸다 (토큰 해시는 빈 글자가 아니다)
    const id = account.id;
    if (account.endsSessions)
      await this.sql`
        UPDATE community.account_sessions SET ended_at = now()
        WHERE account_id = ${id} AND ended_at IS NULL
          AND token_hash <> ${account.sessionToKeep ?? ''}`;
    const session = account.startedSession;
    if (session?.isNew) await this.insertRows(accountSessions, session.unsaved);
  }

  /** 메일로 그 공간의 계정 (로그인 · 비밀번호 다시 정하기 · 가입한 주소인지). 탈퇴하면 메일을 지워 찾히지 않는다 */
  findByEmail(spaceId: string, email: string, lock = false): Promise<Account | null> {
    return this.findOne({ space_id: spaceId, email, left_at: null }, { lock });
  }

  /** 아이디로 그 공간의 계정 (로그인). 탈퇴하면 아이디를 지워 찾히지 않는다 */
  findByLogin(spaceId: string, loginId: string, lock = false): Promise<Account | null> {
    return this.findOne({ space_id: spaceId, login_id: loginId, left_at: null }, { lock });
  }

  /** 로그아웃: 그 세션을 끝낸다 */
  async endSession(tokenHash: string, now: Date): Promise<void> {
    await this.updateRows(
      accountSessions,
      { ended_at: now },
      { token_hash: tokenHash, ended_at: null },
    );
  }

  /** 마지막 접근: 세션의 끝나는 날을 늘리고 계정 · 그 앱의 회원에 마지막 접근을 적는다 (버전 없이) */
  async touchSession(tokenHash: string, now: Date): Promise<void> {
    const [session] = await this.sql<{ account_id: string; app_id: string }[]>`
      UPDATE community.account_sessions
      SET last_seen_at = ${now}, expires_at = ${AccountSession.expiresFrom(now)}
      WHERE token_hash = ${tokenHash} AND ended_at IS NULL AND expires_at > ${now}
      RETURNING account_id, app_id`;
    if (!session) return;
    await this.updateRows(accounts, { last_seen_at: now }, { id: session.account_id });
    await this.updateRows(
      members,
      { last_seen_at: now },
      { account_id: session.account_id, app_id: session.app_id },
    );
  }
}
