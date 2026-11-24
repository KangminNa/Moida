import { Injectable, Logger } from '@nestjs/common';
import {
  type Actor,
  AttemptLimiter,
  BaseService,
  Conflict,
  Database,
  InvalidRequest,
  Lookups,
  MemberActor,
  PasswordHasher,
  Unauthenticated,
} from '../../platform';
import { TermsQuery } from '../terms/terms.query';
import { LoginId } from './login-id.policy';
import { Member } from './member';
import type {
  JoinInput,
  LeaveInput,
  LoginInput,
  MemberPlace,
  PasswordInput,
  RenameInput,
} from './member.input';
import { MemberRepository } from './member.repository';
import { MemberPassword } from './member-password.policy';
import { MemberSession } from './member-session';

// 회원 쓰기 (스토어 3-1, 아이디 · 비밀번호 가입 2026-11-19): 가입(약관 동의, 3-4) · 로그인 · 비밀번호 바꾸기 · 닉네임 바꾸기 · 탈퇴(3-4) · 로그아웃 · 마지막 접근.
// 해킹에 대비한 규칙 (11.1):
// - 비밀번호는 scrypt 해시만 둔다 (PasswordHasher). 해시는 느린 일이라 트랜잭션 밖에서 만들고 확인한다
// - 로그인 실패 문구는 하나다: 아이디가 있는지 알려 주지 않고, 없는 아이디도 같은 시간을 들여 확인한다 (PasswordHasher.verify의 가짜 값)
// - 틀린 시도는 아이디마다 · 곳(IP, IPv6는 /64)마다 센다 (서버 메모리에만, IP는 저장하지 않는다). 넘으면 429
// - 가입은 곳마다 시간당 몇 번까지 (봇 가입 막기). 가입 직후에는 글 · 댓글을 바로 쓰지 못한다 (Member.JOIN_WAIT_MS)
// - 가입 · 로그인할 때마다 새 세션 토큰. 비밀번호를 바꾸면 지금 로그인 말고 다른 로그인은 모두 끝난다
// 모두 앱 도메인의 공개된 커뮤니티 앱에서만 (Lookups 'member-app': 커뮤니티 앱과 선언서에 members를 적은 앱, 스토어 12.3)
@Injectable()
export class MemberService extends BaseService {
  /** 틀린 로그인: 한 아이디에 15분에 5번, 한 곳에서 15분에 20번 */
  static readonly TRIES_PER_LOGIN = 5;
  static readonly TRIES_PER_PLACE = 20;
  static readonly TRY_WINDOW_MS = 15 * 60_000;
  /** 가입: 한 곳에서 1시간에 3번 */
  static readonly JOINS_PER_PLACE = 3;
  static readonly JOIN_WINDOW_MS = 60 * 60_000;
  private static readonly WRONG = '아이디나 비밀번호가 맞지 않아요';
  private static readonly TOUCHED_MAX = 10_000;
  private readonly logger = new Logger('회원');
  /** 마지막 접근을 적은 때 (세션 해시 → ms). 요청마다 쓰지 않게 */
  private readonly touched = new Map<string, number>();
  private readonly byLogin = new AttemptLimiter(
    MemberService.TRIES_PER_LOGIN,
    MemberService.TRY_WINDOW_MS,
  );
  private readonly byPlace = new AttemptLimiter(
    MemberService.TRIES_PER_PLACE,
    MemberService.TRY_WINDOW_MS,
  );
  private readonly joins = new AttemptLimiter(
    MemberService.JOINS_PER_PLACE,
    MemberService.JOIN_WINDOW_MS,
  );

  constructor(
    db: Database,
    private readonly lookups: Lookups,
    private readonly hasher: PasswordHasher,
    private readonly terms: TermsQuery,
  ) {
    super(db);
  }

  /** 가입: 회원 + 첫 로그인. 아이디 · 닉네임이 겹치면 409, 한 곳에서 너무 많이 가입하면 429 */
  async join(actor: Actor, place: MemberPlace, req: JoinInput): Promise<Member> {
    await this.assertCommunity(actor, place);
    await this.assertAgreed(actor, place, req);
    const at = MemberService.placeOf(place);
    this.joins.check(at);
    const loginId = LoginId.clean(req.loginId);
    MemberPassword.check(req.password, loginId, req.nickname);
    const hash = await this.hasher.hash(req.password);
    const member = Member.join(
      place.appId,
      loginId,
      hash,
      req.nickname,
      req.ageConfirmed,
      new Date(),
    );
    member.agree(req.termsVersion, req.privacyVersion);
    // 규칙을 지난 가입 시도를 센다: 겹치는 아이디로 있는 아이디를 찔러보는 것도 함께 막힌다
    this.joins.fail(at);
    await this.transaction((tx) => new MemberRepository(tx).save(member));
    return member;
  }

  /** 로그인: 새 세션. 틀리면 401 (아이디가 없어도 같은 문구 · 같은 시간), 많이 틀리면 429 */
  async login(actor: Actor, place: MemberPlace, req: LoginInput): Promise<Member> {
    await this.assertCommunity(actor, place);
    const who = `${place.appId}:${req.loginId}`;
    const at = MemberService.placeOf(place);
    this.byPlace.check(at);
    this.byLogin.check(who);
    const found = await this.transaction((tx) =>
      new MemberRepository(tx).findByLogin(place.appId, req.loginId),
    );
    if (!(await this.hasher.verify(req.password, found?.passwordHash ?? null)) || !found) {
      this.byPlace.fail(at);
      this.byLogin.fail(who);
      throw new Unauthenticated(MemberService.WRONG);
    }
    return this.transaction(async (tx) => {
      const members = new MemberRepository(tx);
      const member = await members.lock(place.appId, found.id);
      member.startSession(new Date());
      await members.save(member);
      return member;
    });
  }

  /**
   * 비밀번호 바꾸기 (그 회원만): 지금 비밀번호가 맞아야 하고(틀리면 로그인처럼 센다), 새 비밀번호는 같은 규칙.
   * 이 브라우저(token) 말고 다른 로그인은 모두 끝난다
   */
  async changePassword(
    actor: Actor,
    place: MemberPlace,
    req: PasswordInput,
    token: string | null,
  ): Promise<void> {
    const me = MemberActor.require(actor, place.appId);
    if (!token) throw new Unauthenticated('로그인이 필요해요');
    const who = `${place.appId}:${me.id}`;
    this.byLogin.check(who);
    const current = await this.transaction((tx) =>
      new MemberRepository(tx).load(place.appId, me.id ?? ''),
    );
    if (!(await this.hasher.verify(req.current, current.passwordHash))) {
      this.byLogin.fail(who);
      throw new InvalidRequest(new Map([['current', '지금 비밀번호가 맞지 않아요']]));
    }
    MemberPassword.check(req.next, current.loginId, current.nickname);
    const hash = await this.hasher.hash(req.next);
    await this.transaction(async (tx) => {
      const members = new MemberRepository(tx);
      const member = await members.lock(place.appId, current.id);
      member.changePassword(hash, MemberSession.hash(token), new Date());
      await members.save(member);
    });
  }

  /** 닉네임 바꾸기 (그 회원만) */
  async rename(actor: Actor, place: MemberPlace, req: RenameInput): Promise<Member> {
    const me = MemberActor.require(actor, place.appId);
    await this.assertCommunity(actor, place);
    return this.transaction(async (tx) => {
      const members = new MemberRepository(tx);
      const member = await members.lock(place.appId, me.id ?? '');
      member.assertVersion(req.version);
      member.rename(req.nickname, new Date());
      await members.save(member);
      return member;
    });
  }

  /**
   * 탈퇴 (3-4, 그 회원만): 지금 비밀번호가 맞아야 하고(틀리면 로그인처럼 센다) 개인정보를 지우고 모든 로그인을 끝낸다 (Member.leave).
   * 글 · 댓글은 "탈퇴한 회원"으로 남는다. 차단 중이어도 탈퇴할 수 있다
   */
  async leave(actor: Actor, place: MemberPlace, req: LeaveInput): Promise<void> {
    const me = MemberActor.require(actor, place.appId);
    const who = `${place.appId}:${me.id}`;
    this.byLogin.check(who);
    const current = await this.transaction((tx) =>
      new MemberRepository(tx).load(place.appId, me.id ?? ''),
    );
    if (!(await this.hasher.verify(req.password, current.passwordHash))) {
      this.byLogin.fail(who);
      throw new InvalidRequest(new Map([['password', '비밀번호가 맞지 않아요']]));
    }
    await this.transaction(async (tx) => {
      const members = new MemberRepository(tx);
      const member = await members.lock(place.appId, current.id);
      member.leave(new Date());
      await members.save(member);
    });
  }

  /** 로그아웃: 이 브라우저의 로그인을 끝낸다. 쿠키가 없으면 할 일이 없다 */
  async logout(token: string | null): Promise<void> {
    if (!token) return;
    await this.transaction((tx) =>
      new MemberRepository(tx).endSession(MemberSession.hash(token), new Date()),
    );
  }

  /** 마지막 접근 (MemberGuard). 5분에 한 번만 적고, 실패해도 요청은 막지 않는다 */
  async seen(token: string, now: Date): Promise<void> {
    const hash = MemberSession.hash(token);
    if (now.getTime() - (this.touched.get(hash) ?? 0) < MemberSession.SEEN_MS) return;
    if (this.touched.size > MemberService.TOUCHED_MAX) this.touched.clear();
    this.touched.set(hash, now.getTime());
    await this.transaction((tx) => new MemberRepository(tx).touchSession(hash, now)).catch(
      (error: unknown) => this.logger.error(`마지막 접근을 적지 못했어요: ${String(error)}`),
    );
  }

  /** 시도를 세는 곳: 앱마다 따로 센다 (한 앱이 막혀도 다른 앱은 그대로) */
  private static placeOf(place: MemberPlace): string {
    return `${place.appId}:${AttemptLimiter.place(place.ip)}`;
  }

  /**
   * 가입 화면이 읽은 약관이 지금 공개된 버전인가 (3-4). 둘 중 하나라도 공개 전이면 가입을 받지 않고(관리자가 먼저 공개),
   * 가입 화면을 연 뒤 새 버전이 올라왔으면 다시 읽고 동의하게 한다 (409)
   */
  private async assertAgreed(actor: Actor, place: MemberPlace, req: JoinInput): Promise<void> {
    const now = await this.terms.versions(actor, place.appId);
    if (now.get('terms') == null || now.get('privacy') == null)
      throw new Conflict('아직 약관이 공개되지 않아 가입할 수 없어요');
    if (now.get('terms') !== req.termsVersion || now.get('privacy') !== req.privacyVersion)
      throw new Conflict('약관이 바뀌었어요. 다시 읽고 동의해 주세요');
  }

  private assertCommunity(actor: Actor, place: MemberPlace): Promise<void> {
    return this.lookups.assertVisible('member-app', actor, [place.appId], '없는 주소예요');
  }
}
