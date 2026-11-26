import { Injectable } from '@nestjs/common';
import {
  type Actor,
  AttemptLimiter,
  BaseService,
  CodeMail,
  Database,
  EmailAddress,
  HostGate,
  InvalidRequest,
  PasswordHasher,
  VerifyCodes,
} from '../../platform';
import { MemberPassword } from '../member/member-password.policy';
import { TermsQuery } from '../terms/terms.query';
import { TermsConsent } from '../terms/terms-consent.policy';
import { Account } from './account';
import type { CodeRequestInput, StoreJoinInput, StorePlace } from './account.input';
import { AccountRepository } from './account.repository';
import { AccountMailService } from './account-mail.service';
import { LoginId } from './login-id.policy';

// 스토어에서 가입 (2026-11-26, 사용자 "스토어 가입을 넣고 회원가입 페이지 따로 만들어줘"): 앱을 고르지 않고 스토어 첫 화면의 가입 화면에서
// 계정만 만든다. 기본 도메인은 콘솔과 같은 출처라 회원 로그인(쿠키)을 열지 않는다 (community 규칙: 기본 도메인에 회원 쿠키 없음).
// 그래서 가입 뒤 로그인은 앱 도메인에서 하고, 앱마다 닉네임을 정해 참여한다. 규칙은 앱에서 하는 가입(AccountMailService)과 같다:
// 메일 인증코드(서버 메모리) · 공통 약관 동의 · 아이디 · 비밀번호 규칙 · 가입한 주소인지 드러내지 않기 · 같은 시도 제한(공간 · 곳마다)
@Injectable()
export class StoreJoinService extends BaseService {
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
    private readonly hasher: PasswordHasher,
    private readonly terms: TermsQuery,
    private readonly mail: CodeMail,
    private readonly gate: HostGate,
  ) {
    super(db);
  }

  /** 가입 인증코드 (가입한 주소면 코드 대신 안내 메일). 공통 약관이 공개돼야 한다. 답은 늘 같다 */
  async sendCode(actor: Actor, place: StorePlace, req: CodeRequestInput): Promise<void> {
    const email = StoreJoinService.address(req.email);
    this.mail.assertReady();
    TermsConsent.assertOpen(await this.terms.versions(actor, { spaceId: place.spaceId }));
    this.sendsByPlace.hit(StoreJoinService.placeOf(place));
    this.sendsByAddress.hit(`${place.spaceId}:${email}`);
    const site = await this.siteName();
    if (await this.joined(place, email)) {
      this.mail.post(
        email,
        `[${site}] 이미 가입한 메일이에요`,
        [
          '이 메일 주소로 만든 계정이 이미 있어요. 같은 계정으로 이 사이트의 모든 앱에 로그인해요.',
          '비밀번호를 잊었다면 앱의 로그인 화면에서 "비밀번호 다시 정하기"를 써 주세요.',
          '',
          '가입을 신청하지 않았다면 이 메일을 무시하세요.',
        ].join('\n'),
      );
      return;
    }
    const code = this.codes.issue(StoreJoinService.key(place, email));
    this.mail.post(
      email,
      `[${site}] 가입 인증코드 ${code}`,
      [
        `${site} 가입 인증코드: ${code}`,
        '',
        `${VerifyCodes.TTL_MS / 60_000}분 안에 가입 화면에 넣어 주세요.`,
        '이 계정 하나로 이 사이트의 모든 앱에 로그인해요.',
        '가입을 신청하지 않았다면 이 메일을 무시하세요.',
      ].join('\n'),
    );
  }

  /** 가입: 코드 확인 → 계정 (로그인 없음). 메일 · 아이디가 겹치면 409, 한 곳에서 너무 많이 가입하면 429 */
  async join(actor: Actor, place: StorePlace, req: StoreJoinInput): Promise<Account> {
    const store = await this.terms.versions(actor, { spaceId: place.spaceId });
    TermsConsent.check(store, new Map(), req.agreement, true);
    const at = StoreJoinService.placeOf(place);
    this.joins.check(at);
    const email = StoreJoinService.address(req.email);
    const loginId = LoginId.clean(req.loginId);
    const key = StoreJoinService.key(place, email);
    this.wrong.check(at);
    if (!this.codes.check(key, req.code)) {
      this.wrong.fail(at);
      throw new InvalidRequest(new Map([['code', StoreJoinService.WRONG_CODE]]));
    }
    MemberPassword.check(req.password, loginId, '');
    MemberPassword.check(req.password, email.split('@')[0] ?? '', '');
    const hash = await this.hasher.hash(req.password);
    const account = Account.create(
      place.spaceId,
      email,
      loginId,
      hash,
      req.ageConfirmed,
      new Date(),
    );
    account.agree(req.agreement.termsVersion ?? 0, req.agreement.privacyVersion ?? 0);
    this.joins.fail(at);
    await this.transaction((tx) => new AccountRepository(tx).save(account));
    this.codes.use(key);
    return account;
  }

  /** 메일 제목의 이름: 사이트 주소의 호스트 (정하기 전이면 "Moida") */
  private async siteName(): Promise<string> {
    return (await this.gate.siteHost()) ?? 'Moida';
  }

  private joined(place: StorePlace, email: string): Promise<Account | null> {
    return this.transaction((tx) => new AccountRepository(tx).findByEmail(place.spaceId, email));
  }

  private static address(raw: string): string {
    const email = EmailAddress.clean(raw);
    if (!email) throw new InvalidRequest(new Map([['email', '메일 주소 모양이 아니에요']]));
    return email;
  }

  private static key(place: StorePlace, email: string): string {
    return `store-join:${place.spaceId}:${email}`;
  }

  private static placeOf(place: StorePlace): string {
    return `${place.spaceId}:${AttemptLimiter.place(place.ip)}`;
  }
}
