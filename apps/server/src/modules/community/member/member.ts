import { BaseEntity, Forbidden, RuleViolation, TableEntity } from '../../platform';
import type { MemberNew, MemberRow } from '../community.tables';
import { MemberSelfView } from './member.view';
import { MemberSession } from './member-session';
import { Nickname } from './nickname.policy';

// 커뮤니티 회원 하나 (community.members, 스토어 3-1). 앱마다 따로다 (같은 사람도 앱이 다르면 다른 회원).
// 아이디 · 비밀번호로 가입한다 (2026-11-19): 아이디는 바꾸지 않고, 비밀번호는 해시(platform PasswordHasher)만 갖는다.
// 이메일 · IP는 갖지 않는다. 관리자가 아니다 (원칙 10): 요청자는 MemberActor이고 권한이 없다
export class Member extends TableEntity<MemberRow, MemberNew> {
  /** 가입하고 이만큼 지나야 글 · 댓글을 쓴다 (스팸, 11.0) */
  static readonly JOIN_WAIT_MS = 5 * 60_000;
  /** 닉네임은 이 간격에 한 번 바꾼다 (자주 바꿔 다른 사람인 척하지 못하게) */
  static readonly RENAME_DAYS = 7;
  private static readonly DAY_MS = 86_400_000;
  /** 무기한 차단의 끝 (DB의 infinity는 Date로 읽히지 않아 먼 날짜로 둔다) */
  static readonly FOREVER = new Date('9999-12-31T00:00:00Z');

  private session: MemberSession | null = null;
  /** 비밀번호를 바꿔 이 세션(해시) 말고 다른 로그인을 모두 끝낸다 */
  private keptSession: string | null = null;

  /**
   * 가입: 만 14세 이상이라고 확인해야 한다 (개인정보, 11.0). 아이디 · 비밀번호 규칙은 Service가 해시를 만들기 전에
   * LoginId · MemberPassword로 본다. 닉네임 규칙은 Nickname, 아이디 · 닉네임 겹침은 DB가 본다 (409). 첫 로그인을 함께 연다
   */
  static join(
    appId: string,
    loginId: string,
    passwordHash: string,
    nickname: string,
    ageConfirmed: boolean,
    now: Date,
  ): Member {
    if (!ageConfirmed) throw new RuleViolation('만 14세 이상만 가입할 수 있어요');
    const clean = Nickname.clean(nickname);
    const member = new Member(
      {
        id: BaseEntity.newId(),
        app_id: appId,
        login_id: loginId,
        password_hash: passwordHash,
        password_changed_at: now,
        nickname: clean,
        nickname_key: Nickname.keyOf(clean),
        age_confirmed_at: now,
        joined_at: now,
      },
      true,
    );
    member.startSession(now);
    return member;
  }

  static restore(row: MemberRow): Member {
    return new Member(row);
  }

  /** 비밀번호 해시 (로그인 · 비밀번호 바꾸기에서 Service가 확인한다) */
  get passwordHash(): string {
    return this.row.password_hash;
  }

  /** 아이디 · 닉네임 (새 비밀번호가 이것과 같은지 MemberPassword가 본다) */
  get loginId(): string {
    return this.row.login_id;
  }

  get nickname(): string {
    return this.row.nickname;
  }

  /** 로그인 하나를 연다 (가입 · 로그인할 때마다 새 토큰: 남이 미리 심은 세션을 이어 쓰지 못하게). 원문 토큰은 이 세션에만 있다 */
  startSession(now: Date): MemberSession {
    this.session = MemberSession.start(this.id, now);
    return this.session;
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

  /**
   * 비밀번호를 바꾼다 (지금 비밀번호 확인과 새 비밀번호 규칙은 Service가 해시 전에 본다).
   * keepSession(지금 로그인의 토큰 해시) 말고 다른 로그인은 모두 끝낸다: 비밀번호가 새어 바꾸는 경우를 위해
   */
  changePassword(passwordHash: string, keepSession: string, now: Date): void {
    this.put('password_hash', passwordHash);
    this.put('password_changed_at', now);
    this.keptSession = keepSession;
  }

  /** 다른 로그인을 모두 끝낼 때 남길 세션의 토큰 해시 (Repository가 끝낸다). 끝낼 것이 없으면 null */
  get sessionToKeep(): string | null {
    return this.keptSession;
  }

  /** 글 · 댓글을 쓰기 전에: 차단 중이면 403, 가입하고 JOIN_WAIT_MS가 지나지 않았으면 422 (스팸 계정이 가입하자마자 쓰지 못하게) */
  assertCanWrite(now: Date): void {
    this.assertActive(now);
    if (now.getTime() - this.row.joined_at.getTime() < Member.JOIN_WAIT_MS)
      throw new RuleViolation(`가입하고 ${Member.JOIN_WAIT_MS / 60_000}분 뒤부터 쓸 수 있어요`);
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
