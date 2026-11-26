import { Injectable } from '@nestjs/common';
import {
  type Actor,
  AttemptLimiter,
  BaseService,
  CodeMail,
  Conflict,
  Database,
  EmailAddress,
  InvalidRequest,
  Lookups,
  NotFound,
  PasswordHasher,
  VerifyCodes,
} from '../../platform';
import { TermsQuery } from '../terms/terms.query';
import { Member } from './member';
import type { CodeRequestInput, JoinInput, MemberPlace, ResetPasswordInput } from './member.input';
import { MemberRepository } from './member.repository';
import { MemberPassword } from './member-password.policy';

// 메일로 하는 회원 일 (2026-11-26, 메일 인증 가입): 가입 인증코드 → 가입, 비밀번호 다시 정하기 인증코드 → 새 비밀번호.
// 인증코드는 서버 메모리에만 (VerifyCodes: 6자리, 10분, 5번 틀리면 버림, 60초 뒤 다시 받기), 메일은 메일 플러그인의 길(CodeMail).
// 가입한 주소인지 드러내지 않는다: 코드를 보내 달라는 요청의 답은 늘 같다 (204). 가입한 주소로 가입 코드를 달라면 코드 대신
// "이미 가입한 주소" 메일을, 가입하지 않은 주소로 비밀번호 코드를 달라면 아무것도 보내지 않는다. 메일은 기다리지 않고 보낸다 (같은 시간)
// 시도 제한 (서버 메모리, IP는 저장하지 않는다): 코드 보내기는 곳마다 1시간에 10통 · 주소마다 1시간에 5통, 가입은 곳마다 1시간에 3번,
// 틀린 코드는 VerifyCodes가 코드마다 5번 + 곳마다 15분에 20번
@Injectable()
export class MemberMailService extends BaseService {
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
    MemberMailService.SENDS_PER_PLACE,
    MemberMailService.SEND_WINDOW_MS,
  );
  private readonly sendsByAddress = new AttemptLimiter(
    MemberMailService.SENDS_PER_ADDRESS,
    MemberMailService.SEND_WINDOW_MS,
  );
  private readonly joins = new AttemptLimiter(
    MemberMailService.JOINS_PER_PLACE,
    MemberMailService.JOIN_WINDOW_MS,
  );
  private readonly wrong = new AttemptLimiter(
    MemberMailService.WRONG_PER_PLACE,
    MemberMailService.WRONG_WINDOW_MS,
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

  /** 가입 인증코드를 보낸다 (이미 가입한 주소면 코드 대신 알림 메일). 답은 늘 같다 */
  async sendJoinCode(actor: Actor, place: MemberPlace, req: CodeRequestInput): Promise<void> {
    const app = await this.appName(actor, place);
    const email = MemberMailService.address(req.email);
    this.mail.assertReady();
    await this.assertTermsOpen(actor, place);
    this.countSend(place, email);
    const joined = await this.transaction((tx) =>
      new MemberRepository(tx).findByEmail(place.appId, email),
    );
    if (joined) {
      this.mail.post(
        email,
        `[${app}] 이미 가입한 메일이에요`,
        [
          `이 메일 주소는 이미 ${app}에 가입되어 있어요.`,
          '로그인하거나, 비밀번호를 잊었다면 로그인 화면의 "비밀번호 다시 정하기"를 써 주세요.',
          '',
          '가입을 신청하지 않았다면 이 메일을 무시하세요.',
        ].join('\n'),
      );
      return;
    }
    const code = this.codes.issue(MemberMailService.key('join', place, email));
    this.mail.post(
      email,
      `[${app}] 가입 인증코드 ${code}`,
      [
        `${app} 가입 인증코드: ${code}`,
        '',
        `${VerifyCodes.TTL_MS / 60_000}분 안에 가입 화면에 넣어 주세요.`,
        '가입을 신청하지 않았다면 이 메일을 무시하세요.',
      ].join('\n'),
    );
  }

  /** 가입: 코드 확인 → 회원 + 첫 로그인. 메일 · 닉네임이 겹치면 409, 한 곳에서 너무 많이 가입하면 429 */
  async join(actor: Actor, place: MemberPlace, req: JoinInput): Promise<Member> {
    await this.appName(actor, place);
    await this.assertAgreed(actor, place, req);
    const at = MemberMailService.placeOf(place);
    this.joins.check(at);
    const email = MemberMailService.address(req.email);
    const key = MemberMailService.key('join', place, email);
    this.checkCode(place, key, req.code);
    MemberPassword.check(req.password, email.split('@')[0] ?? '', req.nickname);
    const hash = await this.hasher.hash(req.password);
    const member = Member.join(
      place.appId,
      email,
      hash,
      req.nickname,
      req.ageConfirmed,
      new Date(),
    );
    member.agree(req.termsVersion, req.privacyVersion);
    this.joins.fail(at);
    await this.transaction((tx) => new MemberRepository(tx).save(member));
    this.codes.use(key);
    return member;
  }

  /** 비밀번호 다시 정하기 인증코드 (가입한 주소에만 보낸다). 답은 늘 같다 */
  async sendResetCode(actor: Actor, place: MemberPlace, req: CodeRequestInput): Promise<void> {
    const app = await this.appName(actor, place);
    const email = MemberMailService.address(req.email);
    this.mail.assertReady();
    this.countSend(place, email);
    const found = await this.transaction((tx) =>
      new MemberRepository(tx).findByEmail(place.appId, email),
    );
    if (!found) return;
    const code = this.codes.issue(MemberMailService.key('reset', place, email));
    this.mail.post(
      email,
      `[${app}] 비밀번호 다시 정하기 인증코드 ${code}`,
      [
        `${app} 비밀번호 다시 정하기 인증코드: ${code}`,
        '',
        `${VerifyCodes.TTL_MS / 60_000}분 안에 넣어 주세요. 새 비밀번호를 정하면 모든 기기에서 로그아웃돼요.`,
        '요청하지 않았다면 이 메일을 무시하세요. 비밀번호는 그대로예요.',
      ].join('\n'),
    );
  }

  /** 코드로 새 비밀번호를 정한다. 모든 로그인이 끝난다 (다시 로그인) */
  async resetPassword(actor: Actor, place: MemberPlace, req: ResetPasswordInput): Promise<void> {
    await this.appName(actor, place);
    const email = MemberMailService.address(req.email);
    const key = MemberMailService.key('reset', place, email);
    this.checkCode(place, key, req.code);
    const found = await this.transaction((tx) =>
      new MemberRepository(tx).findByEmail(place.appId, email),
    );
    if (!found) throw new InvalidRequest(new Map([['code', MemberMailService.WRONG_CODE]]));
    MemberPassword.check(req.password, found.loginName, found.nickname);
    const hash = await this.hasher.hash(req.password);
    await this.transaction(async (tx) => {
      const members = new MemberRepository(tx);
      const member = await members.lock(place.appId, found.id);
      member.setPasswordByMail(hash, new Date());
      await members.save(member);
    });
    this.codes.use(key);
  }

  /** 코드가 맞는가. 틀리면 곳마다 세고 422 (코드는 VerifyCodes가 5번 틀리면 버린다) */
  private checkCode(place: MemberPlace, key: string, code: string): void {
    const at = MemberMailService.placeOf(place);
    this.wrong.check(at);
    if (this.codes.check(key, code)) return;
    this.wrong.fail(at);
    throw new InvalidRequest(new Map([['code', MemberMailService.WRONG_CODE]]));
  }

  private countSend(place: MemberPlace, email: string): void {
    this.sendsByPlace.hit(MemberMailService.placeOf(place));
    this.sendsByAddress.hit(`${place.appId}:${email}`);
  }

  private static address(raw: string): string {
    const email = EmailAddress.clean(raw);
    if (!email) throw new InvalidRequest(new Map([['email', '메일 주소 모양이 아니에요']]));
    return email;
  }

  private static key(use: 'join' | 'reset', place: MemberPlace, email: string): string {
    return `${use}:${place.appId}:${email}`;
  }

  /** 시도를 세는 곳: 앱마다 따로 (한 앱이 막혀도 다른 앱은 그대로) */
  private static placeOf(place: MemberPlace): string {
    return `${place.appId}:${AttemptLimiter.place(place.ip)}`;
  }

  /** 회원을 받는 공개 앱인가, 그 이름 (메일 제목). 아니면 404 */
  private async appName(actor: Actor, place: MemberPlace): Promise<string> {
    const name = (await this.lookups.visible('member-app', actor, [place.appId])).get(place.appId);
    if (name === undefined) throw new NotFound('없는 주소예요');
    return name;
  }

  /** 약관이 둘 다 공개돼야 가입을 받는다 (코드를 보내기 전에 먼저 알린다). 지금 공개된 버전들 */
  private async assertTermsOpen(
    actor: Actor,
    place: MemberPlace,
  ): Promise<ReadonlyMap<string, number | null>> {
    const now = await this.terms.versions(actor, place.appId);
    if (now.get('terms') == null || now.get('privacy') == null)
      throw new Conflict('아직 약관이 공개되지 않아 가입할 수 없어요');
    return now;
  }

  /**
   * 가입 화면이 읽은 약관이 지금 공개된 버전인가 (3-4). 가입 화면을 연 뒤 새 버전이 올라왔으면 다시 읽고 동의하게 한다 (409)
   */
  private async assertAgreed(actor: Actor, place: MemberPlace, req: JoinInput): Promise<void> {
    const now = await this.assertTermsOpen(actor, place);
    if (now.get('terms') !== req.termsVersion || now.get('privacy') !== req.privacyVersion)
      throw new Conflict('약관이 바뀌었어요. 다시 읽고 동의해 주세요');
  }
}
