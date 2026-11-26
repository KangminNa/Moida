import { BaseEntity, Conflict, Forbidden, RuleViolation, TableEntity } from '../../platform';
import type { MemberNew, MemberRow } from '../community.tables';
import { MemberDecidedView, MemberResetView } from '../moderation/moderation.view';
import { MemberSelfView } from './member.view';
import { MemberSession } from './member-session';
import { Nickname } from './nickname.policy';

// 커뮤니티 회원 하나 (community.members, 스토어 3-1). 앱마다 따로다 (같은 사람도 앱이 다르면 다른 회원).
// 메일 인증코드로 가입하고 메일 + 비밀번호로 로그인한다 (2026-11-26, 전에는 아이디 · 비밀번호 2026-11-19).
// 메일 · 아이디는 바꾸지 않고, 비밀번호는 해시(platform PasswordHasher)만 갖는다. 아이디로 가입한 회원은 아이디로 그대로 로그인한다.
// IP는 갖지 않는다. 관리자가 아니다 (원칙 10): 요청자는 MemberActor이고 권한이 없다
export class Member extends TableEntity<MemberRow, MemberNew> {
  /** 가입하고 이만큼 지나야 글 · 댓글을 쓴다 (스팸, 11.0) */
  static readonly JOIN_WAIT_MS = 5 * 60_000;
  /** 닉네임은 이 간격에 한 번 바꾼다 (자주 바꿔 다른 사람인 척하지 못하게) */
  static readonly RENAME_DAYS = 7;
  private static readonly DAY_MS = 86_400_000;
  /** 무기한 차단의 끝 (DB의 infinity는 Date로 읽히지 않아 먼 날짜로 둔다) */
  static readonly FOREVER = new Date('9999-12-31T00:00:00Z');

  private session: MemberSession | null = null;
  /** 이번 저장에서 로그인을 끝낸다 (비밀번호 바꾸기 · 초기화) */
  private endingSessions = false;
  /** 로그인을 끝낼 때 남길 세션(토큰 해시). 비밀번호 초기화는 모두 끝낸다 (null) */
  private keptSession: string | null = null;
  /** 관리자가 초기화해 만든 임시 비밀번호 (이번 응답에 한 번만, 저장하지 않는다) */
  private issuedPassword: string | null = null;

  /**
   * 가입: 만 14세 이상이라고 확인해야 한다 (개인정보, 11.0). 메일은 Service가 인증코드로 확인한 주소(EmailAddress.clean),
   * 비밀번호 규칙은 Service가 해시를 만들기 전에 MemberPassword로 본다. 닉네임 규칙은 Nickname, 메일 · 닉네임 겹침은 DB가 본다 (409).
   * 첫 로그인을 함께 연다
   */
  static join(
    appId: string,
    email: string,
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
        login_id: null,
        email,
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

  /** 탈퇴한 회원이 글 · 댓글 · 관리 화면에 보이는 이름 (Nickname이 회원에게는 막는다) */
  static readonly LEFT_NAME = '탈퇴한 회원';

  /**
   * 가입할 때 동의한 약관 버전 (3-4). 동의는 그때 공개된 버전이어야 한다: Service가 TermsQuery.versions와 맞춰 본다
   * (가입 화면을 연 뒤 약관이 바뀌었으면 409로 다시 읽게)
   */
  agree(termsVersion: number, privacyVersion: number): void {
    this.put('terms_version', termsVersion);
    this.put('privacy_version', privacyVersion);
  }

  /**
   * 탈퇴 (3-4, 원칙 2의 예외: 개인정보보호법). 아이디 · 메일 · 비밀번호 해시 · 닉네임 · 차단 메모 · 마지막 접근을 지우고 모든 로그인을 끝낸다.
   * 줄은 남긴다: 글 · 댓글 · 신고 · 결정 기록이 회원 id를 가리킨다 (글은 "탈퇴한 회원"으로 보인다).
   * 아이디 'left:<id>' · 빈 해시 · 겹침 열쇠 'left:<id>'는 DB CHECK가 탈퇴한 줄에만 받는다. 이미 탈퇴했으면 409
   */
  leave(now: Date): void {
    if (this.row.left_at) throw new Conflict('이미 탈퇴한 회원이에요');
    const gone = `left:${this.id}`;
    this.put('left_at', now);
    this.put('login_id', gone);
    this.put('email', null);
    this.put('password_hash', '');
    this.put('nickname', Member.LEFT_NAME);
    this.put('nickname_key', gone);
    this.put('block_note', null);
    this.put('renamed_at', null);
    this.put('last_seen_at', null);
    this.endingSessions = true;
    this.keptSession = null;
  }

  /** 비밀번호 해시 (로그인 · 비밀번호 바꾸기에서 Service가 확인한다) */
  get passwordHash(): string {
    return this.row.password_hash;
  }

  /** 로그인에 쓰는 이름: 아이디, 메일로 가입했으면 메일의 @ 앞 (새 비밀번호가 이것과 같은지 MemberPassword가 본다) */
  get loginName(): string {
    return this.row.login_id ?? (this.row.email ?? '').split('@')[0] ?? '';
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
    this.endingSessions = true;
    this.keptSession = keepSession;
  }

  /**
   * 관리자의 비밀번호 초기화 (3-1c): 이메일을 받지 않아 비밀번호를 잊은 회원은 관리자에게 묻는다 (11.0 ④).
   * 임시 비밀번호(MemberPassword.temporary)는 이번 응답에만 싣고, 모든 로그인을 끝낸다
   */
  resetPassword(passwordHash: string, temporary: string, now: Date): void {
    this.put('password_hash', passwordHash);
    this.put('password_changed_at', now);
    this.endingSessions = true;
    this.keptSession = null;
    this.issuedPassword = temporary;
  }

  /**
   * 메일로 받은 인증코드로 비밀번호를 다시 정한다 (2026-11-26, 비밀번호를 잊었을 때). 코드 확인 · 새 비밀번호 규칙은 Service가 본다.
   * 모든 로그인을 끝낸다 (비밀번호를 잊은 사이 남이 쓰던 로그인까지). 탈퇴한 회원은 Repository가 찾지 않는다
   */
  setPasswordByMail(passwordHash: string, now: Date): void {
    this.put('password_hash', passwordHash);
    this.put('password_changed_at', now);
    this.endingSessions = true;
    this.keptSession = null;
  }

  /** 이번 저장에서 로그인을 끝내는가 (Repository가 끝낸다) */
  get endsSessions(): boolean {
    return this.endingSessions;
  }

  /** 로그인을 끝낼 때 남길 세션의 토큰 해시. 모두 끝내면 null */
  get sessionToKeep(): string | null {
    return this.keptSession;
  }

  /**
   * 관리자의 차단 (3-1c): until까지, 없으면 무기한(FOREVER). 차단 중이면 쓰기 · 신고 · 닉네임 바꾸기가 403이고
   * 로그인 · 읽기 · 자기 글 지우기는 된다 (차단된 것을 내 정보에서 본다)
   */
  block(until: Date | null, now: Date): void {
    const end = until ?? Member.FOREVER;
    if (end.getTime() <= now.getTime() || end.getTime() > Member.FOREVER.getTime())
      throw new RuleViolation('차단이 끝나는 때는 지금보다 뒤여야 해요');
    this.put('blocked_until', end);
  }

  /** 차단 풀기: 차단 중인 회원만 (아니면 409) */
  unblock(now: Date): void {
    const until = this.row.blocked_until;
    if (!until || until.getTime() <= now.getTime()) throw new Conflict('차단된 회원이 아니에요');
    this.put('blocked_until', null);
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

  /** 관리자 결정 뒤의 회원 (차단 · 풀기) */
  decidedView(): MemberDecidedView {
    return new MemberDecidedView(this.row);
  }

  /** 비밀번호 초기화의 답: 임시 비밀번호를 한 번 싣는다 */
  resetView(): MemberResetView {
    return new MemberResetView(this.row, this.issuedPassword ?? '');
  }

  view(): MemberSelfView {
    return new MemberSelfView(
      this.row,
      new Date(this.row.joined_at.getTime() + Member.JOIN_WAIT_MS),
    );
  }
}
