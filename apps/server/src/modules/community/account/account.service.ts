import { Injectable, Logger } from '@nestjs/common';
import {
  type Actor,
  AttemptLimiter,
  BaseService,
  Database,
  EmailAddress,
  InvalidRequest,
  Lookups,
  MemberActor,
  PasswordHasher,
  Unauthenticated,
} from '../../platform';
import type { LeaveInput, MemberPlace } from '../member/member.input';
import { MemberRepository } from '../member/member.repository';
import { MemberPassword } from '../member/member-password.policy';
import type { Account } from './account';
import type { LoginIdInput, LoginInput, PasswordInput, SuspendInput } from './account.input';
import { AccountRepository } from './account.repository';
import { AccountSession } from './account-session';
import { LoginId } from './login-id.policy';

// 스토어 계정 쓰기 (2026-11-26): 로그인 · 로그아웃 · 비밀번호 바꾸기 · 아이디 정하기 · 계정 탈퇴 · 마지막 접근, 관리자의 정지 · 풀기.
// 가입 · 비밀번호 다시 정하기 · 메일 등록은 메일 인증코드로 (AccountMailService). 로그인은 메일이나 아이디 + 비밀번호, 앱 도메인마다 따로.
// 해킹에 대비한 규칙 (11.1):
// - 비밀번호는 scrypt 해시만 둔다 (PasswordHasher). 해시는 느린 일이라 트랜잭션 밖에서 만들고 확인한다
// - 로그인 실패 문구는 하나다: 메일 · 아이디가 있는지 알려 주지 않고, 없어도 같은 시간을 들여 확인한다 (PasswordHasher.verify의 가짜 값)
// - 틀린 시도는 메일 · 아이디마다 · 곳(IP, IPv6는 /64)마다 공간(스토어) 단위로 센다 (서버 메모리에만, IP는 저장하지 않는다). 넘으면 429
// - 로그인할 때마다 새 세션 토큰. 비밀번호를 바꾸면 지금 로그인 말고 모든 앱의 다른 로그인이 끝난다
// 모두 앱 도메인의 회원을 받는 공개 앱에서만 (Lookups 'member-app'), 정지 · 풀기는 관리자만 (기본 도메인)
@Injectable()
export class AccountService extends BaseService {
  /** 틀린 로그인: 한 계정에 15분에 5번, 한 곳에서 15분에 20번 */
  static readonly TRIES_PER_LOGIN = 5;
  static readonly TRIES_PER_PLACE = 20;
  static readonly TRY_WINDOW_MS = 15 * 60_000;
  private static readonly WRONG = '메일 · 아이디나 비밀번호가 맞지 않아요';
  private static readonly TOUCHED_MAX = 10_000;
  private readonly logger = new Logger('회원 계정');
  /** 마지막 접근을 적은 때 (세션 해시 → ms). 요청마다 쓰지 않게 */
  private readonly touched = new Map<string, number>();
  private readonly byLogin = new AttemptLimiter(
    AccountService.TRIES_PER_LOGIN,
    AccountService.TRY_WINDOW_MS,
  );
  private readonly byPlace = new AttemptLimiter(
    AccountService.TRIES_PER_PLACE,
    AccountService.TRY_WINDOW_MS,
  );

  constructor(
    db: Database,
    private readonly lookups: Lookups,
    private readonly hasher: PasswordHasher,
  ) {
    super(db);
  }

  /** 로그인: 이 앱 도메인에 새 세션. 틀리면 401 (메일 · 아이디가 없어도 같은 문구 · 같은 시간), 많이 틀리면 429, 정지면 403 */
  async login(actor: Actor, place: MemberPlace, req: LoginInput): Promise<Account> {
    await this.assertApp(actor, place);
    const who = `${place.spaceId}:${req.login}`;
    const at = AccountService.placeOf(place);
    this.byPlace.check(at);
    this.byLogin.check(who);
    const email = EmailAddress.looksLike(req.login) ? EmailAddress.clean(req.login) : null;
    const found = await this.transaction(async (tx) => {
      const accounts = new AccountRepository(tx);
      if (email) return accounts.findByEmail(place.spaceId, email);
      if (EmailAddress.looksLike(req.login)) return null;
      return accounts.findByLogin(place.spaceId, req.login);
    });
    if (!(await this.hasher.verify(req.password, found?.passwordHash ?? null)) || !found) {
      this.byPlace.fail(at);
      this.byLogin.fail(who);
      throw new Unauthenticated(AccountService.WRONG);
    }
    return this.transaction(async (tx) => {
      const accounts = new AccountRepository(tx);
      const account = await accounts.lock(place.spaceId, found.id);
      account.startSession(place.appId, new Date());
      await accounts.save(account);
      return account;
    });
  }

  /**
   * 비밀번호 바꾸기 (그 계정만): 지금 비밀번호가 맞아야 하고(틀리면 로그인처럼 센다), 새 비밀번호는 같은 규칙.
   * 이 브라우저(token) 말고 모든 앱의 다른 로그인이 끝난다
   */
  async changePassword(
    actor: Actor,
    place: MemberPlace,
    req: PasswordInput,
    token: string | null,
  ): Promise<void> {
    const me = MemberActor.requireAccount(actor, place.appId);
    if (!token) throw new Unauthenticated('로그인이 필요해요');
    const current = await this.verified(place, me.accountId, req.current, 'current');
    for (const name of current.passwordNames) MemberPassword.check(req.next, name, '');
    const hash = await this.hasher.hash(req.next);
    await this.transaction(async (tx) => {
      const accounts = new AccountRepository(tx);
      const account = await accounts.lock(place.spaceId, current.id);
      account.changePassword(hash, AccountSession.hash(token), new Date());
      await accounts.save(account);
    });
  }

  /** 아이디 정하기 (아이디가 없는 옛 계정만, 한 번): 겹치면 409 */
  async setLoginId(actor: Actor, place: MemberPlace, req: LoginIdInput): Promise<Account> {
    const me = MemberActor.requireAccount(actor, place.appId);
    const loginId = LoginId.clean(req.loginId);
    return this.transaction(async (tx) => {
      const accounts = new AccountRepository(tx);
      const account = await accounts.lock(place.spaceId, me.accountId);
      account.assertVersion(req.version);
      account.setLoginId(loginId);
      await accounts.save(account);
      return account;
    });
  }

  /**
   * 계정 탈퇴 (그 계정만): 지금 비밀번호가 맞아야 한다. 모든 앱에서 나가고(Member.leave) 계정의 개인정보를 지우고
   * 모든 로그인을 끝낸다 (Account.leave). 글 · 댓글은 앱마다 "탈퇴한 회원"으로 남는다. 잠그는 순서는 계정 → 회원
   */
  async leave(actor: Actor, place: MemberPlace, req: LeaveInput): Promise<void> {
    const me = MemberActor.requireAccount(actor, place.appId);
    const current = await this.verified(place, me.accountId, req.password, 'password');
    await this.transaction(async (tx) => {
      const accounts = new AccountRepository(tx);
      const members = new MemberRepository(tx);
      const account = await accounts.lock(place.spaceId, current.id);
      const now = new Date();
      for (const member of await members.lockAllOfAccount(account.id)) {
        member.leave(now);
        await members.save(member);
      }
      account.leave(now);
      await accounts.save(account);
    });
  }

  /** 로그아웃: 이 브라우저의 로그인을 끝낸다. 쿠키가 없으면 할 일이 없다 */
  async logout(token: string | null): Promise<void> {
    if (!token) return;
    await this.transaction((tx) =>
      new AccountRepository(tx).endSession(AccountSession.hash(token), new Date()),
    );
  }

  /** 마지막 접근 (MemberGuard). 5분에 한 번만 적고, 실패해도 요청은 막지 않는다 */
  async seen(token: string, now: Date): Promise<void> {
    const hash = AccountSession.hash(token);
    if (now.getTime() - (this.touched.get(hash) ?? 0) < AccountSession.SEEN_MS) return;
    if (this.touched.size > AccountService.TOUCHED_MAX) this.touched.clear();
    this.touched.set(hash, now.getTime());
    await this.transaction((tx) => new AccountRepository(tx).touchSession(hash, now)).catch(
      (error: unknown) => this.logger.error(`마지막 접근을 적지 못했어요: ${String(error)}`),
    );
  }

  /** 관리자의 계정 정지: 모든 앱에서 로그인을 막고 지금 로그인을 끝낸다 */
  suspend(actor: Actor, req: SuspendInput): Promise<Account> {
    return this.onAccount(actor, req, (account, now) => account.suspend(req.until, now));
  }

  /** 관리자의 정지 풀기 */
  unsuspend(actor: Actor, req: SuspendInput): Promise<Account> {
    return this.onAccount(actor, req, (account, now) => account.unsuspend(now));
  }

  private onAccount(
    actor: Actor,
    req: SuspendInput,
    change: (account: Account, now: Date) => void,
  ): Promise<Account> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const accounts = new AccountRepository(tx);
      const account = await accounts.lock(spaceId, req.id);
      account.assertVersion(req.version);
      change(account, new Date());
      await accounts.save(account);
      return account;
    });
  }

  /** 지금 비밀번호 확인 (비밀번호 바꾸기 · 탈퇴): 틀리면 로그인처럼 세고 그 칸의 오류 (422) */
  private async verified(
    place: MemberPlace,
    accountId: string,
    password: string,
    field: string,
  ): Promise<Account> {
    const who = `${place.spaceId}:${accountId}`;
    this.byLogin.check(who);
    const current = await this.transaction((tx) =>
      new AccountRepository(tx).load(place.spaceId, accountId),
    );
    if (!(await this.hasher.verify(password, current.passwordHash))) {
      this.byLogin.fail(who);
      const message =
        field === 'current' ? '지금 비밀번호가 맞지 않아요' : '비밀번호가 맞지 않아요';
      throw new InvalidRequest(new Map([[field, message]]));
    }
    return current;
  }

  /** 시도를 세는 곳: 공간(스토어)마다 (계정이 모든 앱에 하나라서) */
  private static placeOf(place: MemberPlace): string {
    return `${place.spaceId}:${AttemptLimiter.place(place.ip)}`;
  }

  private assertApp(actor: Actor, place: MemberPlace): Promise<void> {
    return this.lookups.assertVisible('member-app', actor, [place.appId], '없는 주소예요');
  }
}
