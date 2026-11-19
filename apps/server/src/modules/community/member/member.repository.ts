import { Conflict, Database, type Row, TableRepository } from '../../platform';
import { memberSessions, members } from '../community.schema';
import type { MemberRow } from '../community.tables';
import { Member } from './member';
import { MemberSession } from './member-session';

// community.members ↔ Member (+ 로그인할 때의 세션 · 비밀번호를 바꿀 때 다른 세션 끝내기). 회원은 공간이 아니라 앱에 든다:
// load · lock의 첫 값은 앱 id다. 아이디 · 닉네임이 겹치면 DB가 막고 409로 바꾼다
export class MemberRepository extends TableRepository<MemberRow, Member> {
  protected readonly table = members;
  protected readonly noun = '회원';

  protected toEntity(row: MemberRow): Member {
    return Member.restore(row);
  }

  protected override select(appId: string, id: string, lock: boolean): Promise<readonly Row[]> {
    return this.rows(members, { id, app_id: appId }, { lock });
  }

  override async save(member: Member): Promise<void> {
    try {
      await super.save(member);
    } catch (error) {
      if (Database.isUniqueViolation(error, 'members_nickname_key'))
        throw new Conflict('이미 쓰는 닉네임이에요');
      if (Database.isUniqueViolation(error, 'members_login_key'))
        throw new Conflict('이미 쓰는 아이디예요');
      throw error;
    }
  }

  protected override async saveParts(member: Member): Promise<void> {
    // 비밀번호를 바꾸면 지금 로그인 말고, 초기화하면 모두 끝낸다 (토큰 해시는 빈 글자가 아니다)
    if (member.endsSessions)
      await this.sql`
        UPDATE community.member_sessions SET ended_at = now()
        WHERE member_id = ${member.id} AND ended_at IS NULL
          AND token_hash <> ${member.sessionToKeep ?? ''}`;
    const session = member.startedSession;
    if (session?.isNew) await this.insertRows(memberSessions, session.unsaved);
  }

  /** 아이디로 그 앱의 회원 (로그인). lock: 로그인을 열 때 */
  findByLogin(appId: string, loginId: string, lock = false): Promise<Member | null> {
    return this.findOne({ app_id: appId, login_id: loginId }, { lock });
  }

  /** 로그아웃: 그 세션을 끝낸다 */
  async endSession(tokenHash: string, now: Date): Promise<void> {
    await this.updateRows(
      memberSessions,
      { ended_at: now },
      { token_hash: tokenHash, ended_at: null },
    );
  }

  /** 마지막 접근: 세션의 끝나는 날을 늘리고 회원의 마지막 접근을 적는다 (버전 없이) */
  async touchSession(tokenHash: string, now: Date): Promise<void> {
    const [session] = await this.sql<{ member_id: string }[]>`
      UPDATE community.member_sessions
      SET last_seen_at = ${now}, expires_at = ${MemberSession.expiresFrom(now)}
      WHERE token_hash = ${tokenHash} AND ended_at IS NULL AND expires_at > ${now}
      RETURNING member_id`;
    if (session) await this.updateRows(members, { last_seen_at: now }, { id: session.member_id });
  }
}
