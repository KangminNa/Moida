import { Injectable } from '@nestjs/common';
import {
  type Actor,
  AttemptLimiter,
  BaseService,
  CodeMail,
  Database,
  EmailAddress,
  InvalidRequest,
  Lookups,
  MemberActor,
  NotFound,
  PasswordHasher,
  VerifyCodes,
} from '../../platform';
import { Member } from '../member/member';
import type { MemberPlace } from '../member/member.input';
import { MemberRepository } from '../member/member.repository';
import { MemberPassword } from '../member/member-password.policy';
import { TermsQuery } from '../terms/terms.query';
import { TermsConsent } from '../terms/terms-consent.policy';
import { Account } from './account';
import type { CodeRequestInput, EmailInput, JoinInput, ResetPasswordInput } from './account.input';
import { AccountRepository } from './account.repository';
import { LoginId } from './login-id.policy';

// 메일로 하는 계정 일 (2026-11-26, 스토어 계정): 가입 인증코드 → 가입(계정 + 이 앱 참여), 비밀번호 다시 정하기, 옛 계정의 메일 등록.
// 인증코드는 서버 메모리에만 (VerifyCodes: 6자리, 10분, 5번 틀리면 버림, 60초 뒤 다시 받기), 메일은 메일 플러그인의 길(CodeMail).
// 가입한 주소인지 드러내지 않는다: 코드를 보내 달라는 요청의 답은 늘 같다 (204). 가입한 주소로 가입 코드를 달라면 코드 대신
// "이미 가입한 주소" 메일을, 가입하지 않은 주소로 비밀번호 코드를 달라면 아무것도 보내지 않는다. 메일은 기다리지 않고 보낸다 (같은 시간)
// 시도 제한 (서버 메모리, IP는 저장하지 않는다, 공간마다): 코드 보내기는 곳마다 1시간에 10통 · 주소마다 1시간에 5통, 가입은 곳마다 1시간에 3번,
// 틀린 코드는 VerifyCodes가 코드마다 5번 + 곳마다 15분에 20번
@Injectable()
export class AccountMailService extends BaseService {
  static readonly SENDS_PER_PLACE = 10;
  static readonly SENDS_PER_ADDRESS = 5;
  static readonly SEND_WINDOW_MS = 60 * 60_000;
  /** 가입: 한 곳에서 1시간에 3번 */
  static readonly JOINS_PER_PLACE = 3;
  static readonly JOIN_WINDOW_MS = 60 * 60_000;
  static readonly WRONG_PER_PLACE = 20;
  static readonly WRONG_WINDOW_MS = 15 * 60_000;
  private static readonly WRONG_CODE = '인증코드가 맞지 않거나 시간이 지났어요. 다시 받아 주세요';
  private readonly codes = new VerifyCodes();
  private readonly sendsByPlace = new AttemptLimiter(
    AccountMailService.SENDS_PER_PLACE,
    AccountMailService.SEND_WINDOW_MS,
  );
  private readonly sendsByAddress = new AttemptLimiter(
    AccountMailService.SENDS_PER_ADDRESS,
    AccountMailService.SEND_WINDOW_MS,
  );
  private readonly joins = new AttemptLimiter(
    AccountMailService.JOINS_PER_PLACE,
    AccountMailService.JOIN_WINDOW_MS,
  );
  private readonly wrong = new AttemptLimiter(
    AccountMailService.WRONG_PER_PLACE,
    AccountMailService.WRONG_WINDOW_MS,
  );

  constructor(
    db: Database,
    private readonly lookups: Lookups,
    private readonly hasher: PasswordHasher,
    private readonly terms: TermsQuery,
    private readonly mail: CodeMail,
  ) {
    super(db);
  }

  /** 가입 인증코드를 보낸다 (이미 가입한 주소면 코드 대신 알림 메일). 공통 약관이 공개돼야 한다. 답은 늘 같다 */
  async sendJoinCode(actor: Actor, place: MemberPlace, req: CodeRequestInput): Promise<void> {
    const app = await this.appName(actor, place);
    const email = AccountMailService.address(req.email);
    this.mail.assertReady();
    TermsConsent.assertOpen(await this.terms.versions(actor, { spaceId: place.spaceId }));
    this.countSend(place, email);
    if (await this.joined(place, email)) {
      this.mail.post(
        email,
        `[${app}] 이미 가입한 메일이에요`,
        [
          `이 메일 주소로 만든 계정이 이미 있어요. 같은 계정으로 이 사이트의 모든 앱을 써요.`,
          '로그인하거나, 비밀번호를 잊었다면 로그인 화면의 "비밀번호 다시 정하기"를 써 주세요.',
          '',
          '가입을 신청하지 않았다면 이 메일을 무시하세요.',
        ].join('\n'),
      );
      return;
    }
    const code = this.codes.issue(AccountMailService.key('join', place, email));
    this.mail.post(
      email,
      `[${app}] 가입 인증코드 ${code}`,
      [
        `${app} 가입 인증코드: ${code}`,
        '',
        `${VerifyCodes.TTL_MS / 60_000}분 안에 가입 화면에 넣어 주세요.`,
        '이 계정으로 이 사이트의 다른 앱에도 다시 가입하지 않고 로그인해요.',
        '가입을 신청하지 않았다면 이 메일을 무시하세요.',
      ].join('\n'),
    );
  }

  /**
   * 가입: 코드 확인 → 계정 + 이 앱 참여 + 첫 로그인을 한 트랜잭션에. 약관은 공통 약관과 (공개했으면) 이 앱 약관에 동의.
   * 메일 · 아이디 · 닉네임이 겹치면 409, 한 곳에서 너무 많이 가입하면 429
   */
  async join(actor: Actor, place: MemberPlace, req: JoinInput): Promise<[Account, Member]> {
    await this.appName(actor, place);
    const store = await this.terms.versions(actor, { spaceId: place.spaceId });
    const app = await this.terms.versions(actor, { appId: place.appId });
    TermsConsent.check(store, app, req.agreement, true);
    const at = AccountMailService.placeOf(place);
    this.joins.check(at);
    const email = AccountMailService.address(req.email);
    const loginId = LoginId.clean(req.loginId);
    const key = AccountMailService.key('join', place, email);
    this.checkCode(place, key, req.code);
    MemberPassword.check(req.password, loginId, req.nickname);
    MemberPassword.check(req.password, email.split('@')[0] ?? '', req.nickname);
    const hash = await this.hasher.hash(req.password);
    const now = new Date();
    const account = Account.join(
      place.spaceId,
      place.appId,
      email,
      loginId,
      hash,
      req.ageConfirmed,
      now,
    );
    account.agree(req.agreement.termsVersion ?? 0, req.agreement.privacyVersion ?? 0);
    account.setNews(req.newsMail, now);
    const member = Member.enter(place.appId, account.id, req.nickname, now, now);
    member.agree(req.agreement.appTermsVersion, req.agreement.appPrivacyVersion);
    this.joins.fail(at);
    await this.transaction(async (tx) => {
      await new AccountRepository(tx).save(account);
      await new MemberRepository(tx).save(member);
    });
    this.codes.use(key);
    return [account, member];
  }

  /** 비밀번호 다시 정하기 인증코드 (가입한 주소에만 보낸다). 답은 늘 같다 */
  async sendResetCode(actor: Actor, place: MemberPlace, req: CodeRequestInput): Promise<void> {
    const app = await this.appName(actor, place);
    const email = AccountMailService.address(req.email);
    this.mail.assertReady();
    this.countSend(place, email);
    if (!(await this.joined(place, email))) return;
    const code = this.codes.issue(AccountMailService.key('reset', place, email));
    this.mail.post(
      email,
      `[${app}] 비밀번호 다시 정하기 인증코드 ${code}`,
      [
        `${app} 비밀번호 다시 정하기 인증코드: ${code}`,
        '',
        `${VerifyCodes.TTL_MS / 60_000}분 안에 넣어 주세요. 새 비밀번호를 정하면 모든 앱 · 기기에서 로그아웃돼요.`,
        '요청하지 않았다면 이 메일을 무시하세요. 비밀번호는 그대로예요.',
      ].join('\n'),
    );
  }

  /** 코드로 새 비밀번호를 정한다. 모든 로그인이 끝난다 (다시 로그인) */
  async resetPassword(actor: Actor, place: MemberPlace, req: ResetPasswordInput): Promise<void> {
    await this.appName(actor, place);
    const email = AccountMailService.address(req.email);
    const key = AccountMailService.key('reset', place, email);
    this.checkCode(place, key, req.code);
    const found = await this.joined(place, email);
    if (!found) throw new InvalidRequest(new Map([['code', AccountMailService.WRONG_CODE]]));
    for (const name of found.passwordNames) MemberPassword.check(req.password, name, '');
    const hash = await this.hasher.hash(req.password);
    await this.transaction(async (tx) => {
      const accounts = new AccountRepository(tx);
      const account = await accounts.lock(place.spaceId, found.id);
      account.resetPassword(hash, new Date());
      await accounts.save(account);
    });
    this.codes.use(key);
  }

  /**
   * 메일이 없는 옛 계정(아이디로 가입)의 메일 등록 인증코드. 다른 계정이 쓰는 주소면 코드 대신 알림 메일. 답은 늘 같다
   */
  async sendEmailCode(actor: Actor, place: MemberPlace, req: CodeRequestInput): Promise<void> {
    const me = MemberActor.requireAccount(actor, place.appId);
    const app = await this.appName(actor, place);
    const email = AccountMailService.address(req.email);
    this.mail.assertReady();
    this.countSend(place, email);
    if (await this.joined(place, email)) {
      this.mail.post(
        email,
        `[${app}] 이미 다른 계정이 쓰는 메일이에요`,
        [
          '이 메일 주소를 등록하려 했지만 이미 다른 계정이 쓰고 있어요.',
          '요청하지 않았다면 이 메일을 무시하세요.',
        ].join('\n'),
      );
      return;
    }
    const code = this.codes.issue(AccountMailService.key(`email:${me.accountId}`, place, email));
    this.mail.post(
      email,
      `[${app}] 메일 등록 인증코드 ${code}`,
      [
        `${app} 메일 등록 인증코드: ${code}`,
        '',
        `${VerifyCodes.TTL_MS / 60_000}분 안에 내 정보 화면에 넣어 주세요.`,
        '요청하지 않았다면 이 메일을 무시하세요.',
      ].join('\n'),
    );
  }

  /** 코드로 확인한 메일을 계정에 넣는다 (메일이 없는 계정만, 409). 다른 계정이 그사이 쓰면 409 */
  async setEmail(actor: Actor, place: MemberPlace, req: EmailInput): Promise<Account> {
    const me = MemberActor.requireAccount(actor, place.appId);
    await this.appName(actor, place);
    const email = AccountMailService.address(req.email);
    const key = AccountMailService.key(`email:${me.accountId}`, place, email);
    this.checkCode(place, key, req.code);
    const account = await this.transaction(async (tx) => {
      const accounts = new AccountRepository(tx);
      const found = await accounts.lock(place.spaceId, me.accountId);
      found.setEmail(email);
      await accounts.save(found);
      return found;
    });
    this.codes.use(key);
    return account;
  }

  /** 그 공간에 이 메일로 가입한 계정 (탈퇴하면 메일을 지워 없다) */
  private joined(place: MemberPlace, email: string): Promise<Account | null> {
    return this.transaction((tx) => new AccountRepository(tx).findByEmail(place.spaceId, email));
  }

  /** 코드가 맞는가. 틀리면 곳마다 세고 422 (코드는 VerifyCodes가 5번 틀리면 버린다) */
  private checkCode(place: MemberPlace, key: string, code: string): void {
    const at = AccountMailService.placeOf(place);
    this.wrong.check(at);
    if (this.codes.check(key, code)) return;
    this.wrong.fail(at);
    throw new InvalidRequest(new Map([['code', AccountMailService.WRONG_CODE]]));
  }

  private countSend(place: MemberPlace, email: string): void {
    this.sendsByPlace.hit(AccountMailService.placeOf(place));
    this.sendsByAddress.hit(`${place.spaceId}:${email}`);
  }

  private static address(raw: string): string {
    const email = EmailAddress.clean(raw);
    if (!email) throw new InvalidRequest(new Map([['email', '메일 주소 모양이 아니에요']]));
    return email;
  }

  /** 코드의 열쇠: 쓰임 · 공간 · 메일 (가입한 앱이 달라도 같은 계정의 코드다) */
  private static key(use: string, place: MemberPlace, email: string): string {
    return `${use}:${place.spaceId}:${email}`;
  }

  /** 시도를 세는 곳: 공간(스토어)마다 */
  private static placeOf(place: MemberPlace): string {
    return `${place.spaceId}:${AttemptLimiter.place(place.ip)}`;
  }

  /** 회원을 받는 공개 앱인가, 그 이름 (메일 제목). 아니면 404 */
  private async appName(actor: Actor, place: MemberPlace): Promise<string> {
    const name = (await this.lookups.visible('member-app', actor, [place.appId])).get(place.appId);
    if (name === undefined) throw new NotFound('없는 주소예요');
    return name;
  }
}
