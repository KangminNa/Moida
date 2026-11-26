import { BaseEntity, Conflict, Forbidden, RuleViolation, TableEntity } from '../../platform';
import type { AccountNew, AccountRow } from '../community.tables';
import { AccountSelfView } from '../member/member.view';
import { AccountSuspendedView } from './account.view';
import { AccountSession } from './account-session';

// 스토어 계정 하나 (community.accounts, 2026-11-26 기획서 결정). 공간(스토어)에 하나이고, 앱의 회원(Member)은 이 계정의 "앱 참여"다.
// 메일 인증코드로 가입하고 메일이나 아이디 + 비밀번호로 로그인한다. 로그인은 앱 도메인마다 따로 연다 (AccountSession).
// 메일 · 아이디는 비어 있을 때만 정하고(옮겨 온 옛 회원) 바꾸지 않는다. 비밀번호는 해시(platform PasswordHasher)만 갖는다.
// IP는 갖지 않는다. 관리자가 아니다 (원칙 10)
export class Account extends TableEntity<AccountRow, AccountNew> {
  /** 무기한 정지의 끝 (DB의 infinity는 Date로 읽히지 않아 먼 날짜로 둔다) */
  static readonly FOREVER = new Date('9999-12-31T00:00:00Z');

  private session: AccountSession | null = null;
  /** 이번 저장에서 로그인을 끝낸다 (비밀번호 바꾸기 · 초기화 · 정지 · 탈퇴) */
  private endingSessions = false;
  /** 로그인을 끝낼 때 남길 세션(토큰 해시). 모두 끝내면 null */
  private keptSession: string | null = null;

  /**
   * 가입: 만 14세 이상이라고 확인해야 한다. 메일은 Service가 인증코드로 확인한 주소, 아이디는 LoginId.clean,
   * 비밀번호 규칙은 Service가 해시를 만들기 전에 본다. 메일 · 아이디 겹침은 DB가 본다 (409). 첫 로그인을 그 앱에 연다
   */
  static join(
    spaceId: string,
    appId: string,
    email: string,
    loginId: string,
    passwordHash: string,
    ageConfirmed: boolean,
    now: Date,
  ): Account {
    const account = Account.create(spaceId, email, loginId, passwordHash, ageConfirmed, now);
    account.startSession(appId, now);
    return account;
  }

  /**
   * 로그인 없이 계정만 (스토어에서 가입, 2026-11-26): 기본 도메인은 콘솔과 같은 출처라 회원 로그인을 열지 않는다.
   * 앱에는 그 앱 도메인에서 로그인해 참여한다
   */
  static create(
    spaceId: string,
    email: string,
    loginId: string,
    passwordHash: string,
    ageConfirmed: boolean,
    now: Date,
  ): Account {
    if (!ageConfirmed) throw new RuleViolation('만 14세 이상만 가입할 수 있어요');
    return new Account(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        login_id: loginId,
        email,
        password_hash: passwordHash,
        password_changed_at: now,
        age_confirmed_at: now,
        joined_at: now,
      },
      true,
    );
  }

  static restore(row: AccountRow): Account {
    return new Account(row);
  }

  get spaceId(): string {
    return this.row.space_id;
  }

  get passwordHash(): string {
    return this.row.password_hash;
  }

  /** 앱에 참여할 때 그 회원에 옮겨 적는 만 14세 확인 때 */
  get ageConfirmedAt(): Date {
    return this.row.age_confirmed_at;
  }

  /** 공통 약관에 동의했는가 (옮겨 온 옛 회원은 아직이다: 앱에 참여할 때 함께 동의한다) */
  get agreed(): boolean {
    return (this.row.terms_version ?? null) !== null && (this.row.privacy_version ?? null) !== null;
  }

  /** 관리자에게 보이는 로그인 이름: 아이디, 없으면 메일 */
  get loginName(): string {
    return this.row.login_id ?? this.row.email ?? '';
  }

  /** 비밀번호와 같으면 안 되는 이름들: 아이디와 메일의 @ 앞 */
  get passwordNames(): string[] {
    const names = [this.row.login_id, (this.row.email ?? '').split('@')[0]];
    return names.filter((n): n is string => !!n);
  }

  /** 공통 약관(스토어의 이용약관 · 개인정보처리방침)에 동의한 버전. 맞는 버전인지는 Service가 TermsConsent로 본다 */
  agree(termsVersion: number, privacyVersion: number): void {
    this.put('terms_version', termsVersion);
    this.put('privacy_version', privacyVersion);
  }

  /** 아이디가 없는 계정(메일로 가입한 옛 회원)에 아이디를 정한다. 이미 있으면 409 (아이디는 바꾸지 않는다) */
  setLoginId(loginId: string): void {
    if (this.row.login_id) throw new Conflict('아이디는 이미 정했어요');
    this.put('login_id', loginId);
  }

  /** 메일이 없는 계정(아이디로 가입한 옛 회원)에 인증코드로 확인한 메일을 넣는다. 이미 있으면 409 */
  setEmail(email: string): void {
    if (this.row.email) throw new Conflict('메일은 이미 등록했어요');
    this.put('email', email);
  }

  /** 로그인할 수 있는가: 정지 중이면 403 */
  assertCanLogin(now: Date): void {
    const until = this.row.suspended_until;
    if (!until || until.getTime() <= now.getTime()) return;
    throw new Forbidden(
      'account',
      until.getTime() >= Account.FOREVER.getTime()
        ? '정지된 계정이에요'
        : `정지된 계정이에요 (${until.toISOString().slice(0, 10)}까지)`,
    );
  }

  /** 로그인 하나를 그 앱 도메인에 연다 (로그인할 때마다 새 토큰: 남이 미리 심은 세션을 이어 쓰지 못하게) */
  startSession(appId: string, now: Date): AccountSession {
    this.assertCanLogin(now);
    this.session = AccountSession.start(this.id, appId, now);
    return this.session;
  }

  get startedSession(): AccountSession | null {
    return this.session;
  }

  /** 비밀번호 바꾸기: keepSession(지금 로그인의 토큰 해시) 말고 모든 앱의 다른 로그인을 끝낸다 */
  changePassword(passwordHash: string, keepSession: string, now: Date): void {
    this.setPassword(passwordHash, now);
    this.keptSession = keepSession;
  }

  /** 메일 코드로 다시 정하기 · 관리자의 초기화: 모든 로그인을 끝낸다 (비밀번호를 잊은 사이 남이 쓰던 로그인까지) */
  resetPassword(passwordHash: string, now: Date): void {
    this.setPassword(passwordHash, now);
    this.keptSession = null;
  }

  /**
   * 관리자의 계정 정지: until까지(없으면 무기한) 로그인을 막고 지금 로그인을 모두 끝낸다.
   * 앱마다의 차단(Member.block)과 달리 모든 앱에서 막힌다
   */
  suspend(until: Date | null, now: Date): void {
    const end = until ?? Account.FOREVER;
    if (end.getTime() <= now.getTime() || end.getTime() > Account.FOREVER.getTime())
      throw new RuleViolation('정지가 끝나는 때는 지금보다 뒤여야 해요');
    this.put('suspended_until', end);
    this.endingSessions = true;
    this.keptSession = null;
  }

  /** 정지 풀기: 정지 중인 계정만 (아니면 409) */
  unsuspend(now: Date): void {
    const until = this.row.suspended_until;
    if (!until || until.getTime() <= now.getTime()) throw new Conflict('정지된 계정이 아니에요');
    this.put('suspended_until', null);
  }

  /**
   * 계정 탈퇴 (원칙 2의 예외: 개인정보보호법): 메일 · 아이디 · 비밀번호 해시 · 마지막 접근을 지우고 모든 로그인을 끝낸다.
   * 앱의 회원에서 나가는 일(Member.leave)은 Service가 같은 트랜잭션에서 한다. 줄은 남긴다 (DB CHECK가 탈퇴한 줄의 빈 값만 받는다)
   */
  leave(now: Date): void {
    if (this.row.left_at) throw new Conflict('이미 탈퇴한 계정이에요');
    this.put('left_at', now);
    this.put('login_id', null);
    this.put('email', null);
    this.put('password_hash', '');
    this.put('last_seen_at', null);
    this.put('suspended_until', null);
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

  /** 관리자의 정지 · 풀기 뒤 */
  suspendedView(): AccountSuspendedView {
    return new AccountSuspendedView(this.row);
  }

  view(): AccountSelfView {
    return new AccountSelfView(this.row);
  }

  private setPassword(passwordHash: string, now: Date): void {
    this.put('password_hash', passwordHash);
    this.put('password_changed_at', now);
    this.endingSessions = true;
  }
}
