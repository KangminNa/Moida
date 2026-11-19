import { BaseEntity, Forbidden, RuleViolation, TableEntity } from '../../platform';
import type { MemberLoginNew, MemberNew, MemberRow } from '../community.tables';
import { MemberSelfView } from './member.view';
import { MemberSession } from './member-session';
import { Nickname } from './nickname.policy';

// 커뮤니티 회원 하나 (community.members, 스토어 3-1). 앱마다 따로다 (같은 카카오 계정도 앱이 다르면 다른 회원).
// 소셜 로그인으로만 들어온다: 가입할 때 로그인 하나(member_logins)와 첫 로그인(member_sessions)을 함께 만든다.
// 비밀번호 · 이메일 · IP는 갖지 않는다. 관리자가 아니다 (원칙 10): 요청자는 MemberActor이고 권한이 없다
export class Member extends TableEntity<MemberRow, MemberNew> {
  /** 가입하고 이만큼 지나야 글 · 댓글을 쓴다 (스팸, 11.0) */
  static readonly JOIN_WAIT_MS = 5 * 60_000;
  /** 닉네임은 이 간격에 한 번 바꾼다 (자주 바꿔 다른 사람인 척하지 못하게) */
  static readonly RENAME_DAYS = 7;
  private static readonly DAY_MS = 86_400_000;
  /** 무기한 차단의 끝 (DB의 infinity는 Date로 읽히지 않아 먼 날짜로 둔다) */
  static readonly FOREVER = new Date('9999-12-31T00:00:00Z');

  private login: MemberLoginNew | null = null;
  private session: MemberSession | null = null;

  /**
   * 소셜 로그인을 마친 사람이 가입한다. 만 14세 이상이라고 확인해야 한다 (개인정보, 11.0).
   * 닉네임의 규칙은 Nickname, 앱 안에서 겹치는지는 DB가 본다 (members_nickname_key → 409)
   */
  static join(
    appId: string,
    nickname: string,
    ageConfirmed: boolean,
    method: string,
    subject: string,
    now: Date,
  ): Member {
    if (!ageConfirmed) throw new RuleViolation('만 14세 이상만 가입할 수 있어요');
    const clean = Nickname.clean(nickname);
    const member = new Member(
      {
        id: BaseEntity.newId(),
        app_id: appId,
        nickname: clean,
        nickname_key: Nickname.keyOf(clean),
        age_confirmed_at: now,
        joined_at: now,
      },
      true,
    );
    member.login = {
      id: BaseEntity.newId(),
      member_id: member.id,
      app_id: appId,
      method,
      subject,
      created_at: now,
    };
    member.startSession(now);
    return member;
  }

  static restore(row: MemberRow): Member {
    return new Member(row);
  }

  /** 로그인 하나를 연다 (가입 · 다시 로그인). 원문 토큰은 이 세션에만 있다 */
  startSession(now: Date): MemberSession {
    this.session = MemberSession.start(this.id, now);
    return this.session;
  }

  /** 이번 저장에서 넣을 로그인 (가입할 때만) */
  get addedLogin(): MemberLoginNew | null {
    return this.login;
  }

  /** 이번 저장에서 넣을 세션 */
  get startedSession(): MemberSession | null {
    return this.session;
  }

  /** 닉네임 바꾸기: 차단 중이면 못 하고, RENAME_DAYS에 한 번. 같은 닉네임이면 그대로 */
  rename(nickname: string, now: Date): void {
    this.assertActive(now);
    const clean = Nickname.clean(nickname);
    if (clean === this.row.nickname) return;
    const last = this.row.renamed_at;
    if (last && now.getTime() - last.getTime() < Member.RENAME_DAYS * Member.DAY_MS)
      throw new RuleViolation(`닉네임은 ${Member.RENAME_DAYS}일에 한 번 바꿀 수 있어요`);
    this.put('nickname', clean);
    this.put('nickname_key', Nickname.keyOf(clean));
    this.put('renamed_at', now);
  }

  /** 쓰기 · 신고 · 닉네임 바꾸기 전에: 차단 중이면 403 (무기한 차단은 FOREVER) */
  assertActive(now: Date): void {
    const until = this.row.blocked_until;
    if (!until || until.getTime() <= now.getTime()) return;
    const day = until.toISOString().slice(0, 10);
    throw new Forbidden(
      'member',
      until.getTime() >= Member.FOREVER.getTime()
        ? '차단된 회원이에요'
        : `차단된 회원이에요 (${day}까지)`,
    );
  }

  view(): MemberSelfView {
    return new MemberSelfView(
      this.row,
      new Date(this.row.joined_at.getTime() + Member.JOIN_WAIT_MS),
    );
  }
}
