import { createHash, randomBytes } from 'node:crypto';
import {
  AttemptLimiter,
  BaseEntity,
  DomainEvent,
  RuleViolation,
  TableEntity,
} from '../../platform';
import type {
  LoginLinkNew,
  SpaceMemberNew,
  UserNew,
  UserRow,
  WebSessionNew,
  WebSessionRow,
} from '../account.tables';
import { OwnerView } from './owner.view';

/** 주인 한 줄: 계정에 주인 자리의 공간을 더해 읽는다 */
export type LoadedOwner = UserRow & { space_id: string };

/** 관리 화면 로그인 한 번 (web_sessions). 토큰 원문은 만든 순간에만 메모리에 있고, DB에는 해시만 둔다 */
export class WebSession extends TableEntity<WebSessionRow, WebSessionNew> {
  static readonly COOKIE = 'cairn_session';
  /** 로그인 유지: 마지막으로 쓴 날부터 (웹 UX U2). 쓸 때마다(마지막 접근을 적을 때) 끝나는 날이 늘어난다 */
  static readonly DAYS = 30;
  /**
   * 쿠키는 브라우저가 지키는 가장 긴 기간(400일)으로 둔다. 로그인이 살아 있는지는 서버의 expires_at이 정해서,
   * 끝나는 날을 늘릴 때 쿠키를 다시 보내지 않아도 된다 (웹이 서버에서 그린 첫 화면의 요청은 Set-Cookie가 브라우저에 닿지 않는다)
   */
  static readonly COOKIE_SECONDS = 400 * 86_400;
  /** 마지막 접근(과 끝나는 날)은 이 간격에 한 번만 적는다 (요청마다 쓰지 않게) */
  static readonly SEEN_MS = 5 * 60_000;
  /** 틀린 로그인을 받는 수: 한 아이디에 · 한 곳(IP)에서, 그 시간(ms) 안에 (맞는 로그인은 세지 않는다). 보안 화면에도 보인다 */
  static readonly TRIES_PER_LOGIN = 5;
  static readonly TRIES_PER_PLACE = 10;
  static readonly TRY_WINDOW_MS = 60_000;
  /** 새 곳에서 로그인했는지 볼 때 거슬러 보는 날수 */
  static readonly KNOWN_DAYS = 90;

  private constructor(
    row: WebSessionRow | WebSessionNew,
    /** 만든 순간에만 있는 원문 (쿠키로 한 번 나간다) */
    readonly token: string | null,
  ) {
    super(row, token !== null);
  }

  static start(userId: string, ip: string, userAgent: string, now: Date): WebSession {
    const token = randomBytes(32).toString('base64url');
    return new WebSession(
      {
        id: BaseEntity.newId(),
        user_id: userId,
        token_hash: WebSession.hash(token),
        ip: ip || null,
        user_agent: userAgent,
        expires_at: WebSession.expiresFrom(now),
      },
      token,
    );
  }

  /** 이때 썼다면 로그인이 끝나는 때 */
  static expiresFrom(now: Date): Date {
    return new Date(now.getTime() + WebSession.DAYS * 86_400_000);
  }

  static restore(row: WebSessionRow): WebSession {
    return new WebSession(row, null);
  }

  static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** 저장할 것이 있는가 (새로 만들었거나 끝냈다) */
  get changed(): boolean {
    return Object.keys(this.unsaved).length > 0;
  }

  matches(tokenHash: string): boolean {
    return this.row.token_hash === tokenHash;
  }

  /** 이미 끝난 로그인인가 (로그아웃 · 끝내기 · 비밀번호 바꾸기) */
  get ended(): boolean {
    return this.row.revoked_at !== null && this.row.revoked_at !== undefined;
  }

  end(now: Date): void {
    this.put('revoked_at', now);
  }
}

// 블로그 주인: 계정(users: 아이디·비밀번호) + 주인 자리(space_members) + 로그인들(web_sessions) + 연결한 외부 계정(login_links).
// 주인은 공간마다 한 명이고, 설치 통행증을 가진 브라우저에서 만든 계정이 된다 (확인은 InstallPolicy).
// 비밀번호는 바꾼 값(PasswordHasher)만 들고 있다.
export class Owner extends TableEntity<UserRow, UserNew> {
  private static readonly ROLE = 'owner';
  /** 화면에 보일 이름의 길이 (DB CHECK users_display_name_len과 같다) */
  static readonly NAME_MAX = 40;
  private readonly sessions: WebSession[] = [];
  /** 다른 로그인을 모두 끝낸다 (비밀번호를 바꾸거나 "다른 곳 모두 로그아웃") */
  private othersEnd = false;
  private keptSession: string | null = null;
  private readonly linked: LoginLinkNew[] = [];
  private readonly unlinked = new Set<string>();

  private constructor(
    row: UserRow | UserNew,
    /** 주인 자리의 공간 (보안 기록 · 알림이 쓴다) */
    readonly spaceId: string,
    fresh = false,
  ) {
    super(row, fresh);
  }

  static create(spaceId: string, login: string, passwordHash: string, now: Date): Owner {
    const owner = new Owner(
      { id: BaseEntity.newId(), login, password_hash: passwordHash, password_changed_at: now },
      spaceId,
      true,
    );
    owner.record(new DomainEvent('account.owner.claimed', 1, spaceId, { userId: owner.id, login }));
    return owner;
  }

  static restore(row: LoadedOwner, sessions: readonly WebSession[] = []): Owner {
    const owner = new Owner(row, row.space_id);
    owner.sessions.push(...sessions);
    return owner;
  }

  get login(): string {
    return this.row.login;
  }

  get passwordHash(): string | null {
    return this.row.password_hash;
  }

  /** 칸이 그대로여도 저장하면 계정 행을 고친다: 같은 주인의 저장(로그인, 비밀번호 바꾸기)이 그 행에서 차례를 기다린다 */
  override get unsaved(): Partial<UserRow> {
    const changed = super.unsaved;
    return Object.keys(changed).length > 0 ? changed : { password_hash: this.row.password_hash };
  }

  /** 주인 자리 행. 새 주인을 저장할 때 Repository가 부른다 */
  get membership(): SpaceMemberNew {
    return { space_id: this.spaceId, user_id: this.id, role: Owner.ROLE };
  }

  /** 다른 로그인을 끝내야 하는가 */
  get endsOtherSessions(): boolean {
    return this.othersEnd;
  }

  /** 다른 로그인을 끝낼 때 남겨 둘 로그인 (지금 로그인). 없으면 모두 끝낸다 */
  get keptSessionId(): string | null {
    return this.keptSession;
  }

  /** 저장할 로그인 (새로 만든 것, 끝낸 것) */
  get changedSessions(): readonly WebSession[] {
    return this.sessions.filter((s) => s.changed);
  }

  /** 저장할 연결 (새로 연결한 것) */
  get newLinks(): readonly LoginLinkNew[] {
    return this.linked;
  }

  /** 저장할 연결 끊기 (방법 이름) */
  get removedLinks(): readonly string[] {
    return [...this.unlinked];
  }

  /** 비밀번호를 바꾼다. keep 말고 다른 로그인은 모두 끝난다 (다른 곳에서 훔친 로그인이 있어도 끊기게) */
  setPassword(hash: string, keep: WebSession | null, now: Date): void {
    this.put('password_hash', hash);
    this.put('password_changed_at', now);
    this.othersEnd = true;
    this.keptSession = keep?.id ?? null;
    this.recordAccess('account.password.changed', { via: keep ? 'web' : 'command' });
  }

  /** 같은 비밀번호를 더 강하게 다시 저장한다. 로그인은 그대로 둔다 */
  rehashPassword(hash: string): void {
    this.put('password_hash', hash);
  }

  /**
   * 새 로그인. 보안 기록 · 알림을 위해 사건(`account.login.succeeded`)을 남긴다.
   * knownIps: 최근(WebSession.KNOWN_DAYS) 로그인한 주소. 주면 그 곳들과 다른 곳인지(newPlace) 적는다 (설치 때는 주지 않는다)
   */
  startSession(
    ip: string,
    userAgent: string,
    now: Date,
    method = 'password',
    knownIps: readonly string[] | null = null,
  ): WebSession {
    const session = WebSession.start(this.id, ip, userAgent, now);
    this.sessions.push(session);
    const place = ip ? AttemptLimiter.place(ip) : null;
    const newPlace =
      knownIps !== null &&
      place !== null &&
      !knownIps.some((k) => AttemptLimiter.place(k) === place);
    this.recordAccess('account.login.succeeded', {
      sessionId: session.id,
      method,
      newPlace,
      ip,
      userAgent,
    });
    return session;
  }

  session(tokenHash: string): WebSession | null {
    return this.sessions.find((s) => s.matches(tokenHash)) ?? null;
  }

  /** 지금 로그인을 끝낸다 (로그아웃) */
  endSession(tokenHash: string, now: Date, ip = '', userAgent = ''): void {
    const session = this.session(tokenHash);
    if (!session || session.ended) return;
    session.end(now);
    this.recordAccess('account.session.ended', { how: 'logout', ip, userAgent });
  }

  /** 다른 곳의 로그인 하나를 끝낸다 (보안 화면). 지금 로그인은 로그아웃으로. 이미 끝났으면 그대로 */
  endSessionById(id: string, currentHash: string, now: Date): void {
    const session = this.sessions.find((s) => s.id === id);
    if (!session) throw new RuleViolation('없는 로그인이에요');
    if (session.matches(currentHash)) throw new RuleViolation('지금 로그인은 로그아웃으로 끝내요');
    if (session.ended) return;
    session.end(now);
    this.recordAccess('account.session.ended', { how: 'ended' });
  }

  /** 지금 로그인 말고 모두 끝낸다 ("다른 곳 모두 로그아웃") */
  endOtherSessions(keep: WebSession): void {
    this.othersEnd = true;
    this.keptSession = keep.id;
    this.recordAccess('account.session.ended', { how: 'others' });
  }

  /** 보안 기록이 될 사건 (AccountSecurity가 같은 트랜잭션에서 platform의 보안 기록으로 옮긴다) */
  private recordAccess(name: string, data: Record<string, string | boolean | null>): void {
    this.record(new DomainEvent(name, 1, this.spaceId, { userId: this.id, ...data }));
  }

  /** 외부 계정을 연결한다. 같은 방법으로 이미 연결한 계정이 있으면 바꾼다 */
  link(method: string, subject: string, label: string): void {
    this.unlinked.add(method);
    this.linked.push({ method, subject, user_id: this.id, label });
  }

  unlink(method: string): void {
    this.unlinked.add(method);
  }

  /**
   * 화면에서 "주인" 대신 보일 이름. 비우면 아이디를 보인다. 본 version이어야 한다 (다른 곳의 저장을 덮지 않게).
   * 이름을 바꿀 때만 version이 오른다: 로그인 · 비밀번호 저장이 이름 고치기와 부딪히지 않게
   */
  rename(name: string | null, seen: number): void {
    this.assertVersion(seen);
    const value = (name ?? '').replace(/\s+/g, ' ').trim();
    if (value.length > Owner.NAME_MAX)
      throw new RuleViolation(`이름은 ${Owner.NAME_MAX}자까지예요`);
    if (/\p{Cc}/u.test(value)) throw new RuleViolation('이름에 쓸 수 없는 글자가 있어요');
    this.put('display_name', value || null);
    this.put('version', this.version + 1);
  }

  view(): OwnerView {
    return new OwnerView(this.row);
  }
}
