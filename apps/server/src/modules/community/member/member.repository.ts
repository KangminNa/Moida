import { Conflict, Database, type Row, TableRepository } from '../../platform';
import { memberLogins, memberSessions, members } from '../community.schema';
import type { MemberRow } from '../community.tables';
import { Member } from './member';
import { MemberSession } from './member-session';

// community.members ↔ Member (+ 가입할 때의 로그인 · 로그인할 때의 세션). 회원은 공간이 아니라 앱에 든다:
// load · lock의 첫 값은 앱 id다. 닉네임 · 로그인이 겹치면 DB가 막고 409로 바꾼다
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
      if (Database.isUniqueViolation(error, 'member_logins_subject_key'))
        throw new Conflict('이미 가입한 계정이에요. 다시 로그인해 주세요');
      throw error;
    }
  }

  protected override async saveParts(member: Member): Promise<void> {
    if (member.addedLogin) await this.insertRows(memberLogins, member.addedLogin);
    const session = member.startedSession;
    if (session?.isNew) await this.insertRows(memberSessions, session.unsaved);
  }

  /** 소셜 로그인의 회원 번호로 그 앱의 회원 */
  async findByLogin(appId: string, method: string, subject: string): Promise<Member | null> {
    const [row] = await this.sql<MemberRow[]>`
      SELECT m.* FROM community.members m
      JOIN community.member_logins l ON l.member_id = m.id
      WHERE l.app_id = ${appId} AND l.method = ${method} AND l.subject = ${subject}`;
    return row ? this.toEntity(row) : null;
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
