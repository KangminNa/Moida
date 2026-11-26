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
  PasswordHasher,
  Unauthenticated,
  VerifyCodes,
} from '../../platform';
import { type Owner, WebSession } from './owner';
import type { OwnerCodeInput, OwnerEmailInput, OwnerResetInput } from './owner.input';
import { OwnerRepository } from './owner.repository';
import { PasswordPolicy } from './password.policy';

// 관리자 비밀번호를 메일 인증코드로 다시 정한다 (2026-11-26). 설치 때 메일로 만든 계정만 (전에 아이디로 만든 계정은 서버 명령줄
// pnpm run owner reset-password 그대로). 메일은 메일 플러그인의 길(CodeMail)로 나가고, 코드는 서버 메모리에만 (VerifyCodes).
// 관리자 메일인지 드러내지 않는다: 코드 요청의 답은 늘 같고(204), 관리자 메일이 아니면 아무것도 보내지 않는다.
// 새 비밀번호를 정하면 모든 로그인이 끝나고 보안 기록에 남는다 (account.password.changed, via mail).
// 로그인 메일 바꾸기도 여기서 한다: 새 메일로 받은 인증코드 + 지금 비밀번호 (아이디로 만든 계정을 메일로 옮기는 길).
// 시도 제한 (서버 메모리): 코드 보내기는 곳마다 1시간에 5통, 틀린 코드는 코드마다 5번 + 곳마다 15분에 10번
@Injectable()
export class OwnerMailService extends BaseService {
  static readonly SENDS_PER_PLACE = 5;
  static readonly SEND_WINDOW_MS = 60 * 60_000;
  private static readonly WRONG_CODE = '인증코드가 맞지 않거나 시간이 지났어요. 다시 받아 주세요';
  private readonly codes = new VerifyCodes();
  private readonly sends = new AttemptLimiter(
    OwnerMailService.SENDS_PER_PLACE,
    OwnerMailService.SEND_WINDOW_MS,
  );
  private readonly wrong = new AttemptLimiter(WebSession.TRIES_PER_PLACE, 15 * 60_000);

  constructor(
    db: Database,
    private readonly passwords: PasswordPolicy,
    private readonly hasher: PasswordHasher,
    private readonly mail: CodeMail,
  ) {
    super(db);
  }

  /** 관리자 메일이면 인증코드를 보낸다. 답은 늘 같다 */
  async sendCode(req: OwnerCodeInput, ip: string): Promise<void> {
    const email = OwnerMailService.address(req.email);
    this.mail.assertReady();
    this.sends.hit(AttemptLimiter.place(ip));
    const owner = await new OwnerRepository(this.db.sql).findByLogin(email);
    if (!owner?.usesEmail(email)) return;
    const code = this.codes.issue(`reset:${email}`);
    this.mail.post(
      email,
      `[Moida] 관리자 비밀번호 다시 정하기 인증코드 ${code}`,
      [
        `관리자 비밀번호 다시 정하기 인증코드: ${code}`,
        '',
        `${VerifyCodes.TTL_MS / 60_000}분 안에 넣어 주세요. 새 비밀번호를 정하면 모든 기기에서 로그아웃돼요.`,
        '요청하지 않았다면 누군가 이 메일 주소를 넣은 것이에요. 비밀번호는 그대로이고, 콘솔 › 보안에서 기록을 볼 수 있어요.',
      ].join('\n'),
    );
  }

  /** 코드로 새 비밀번호. 모든 로그인이 끝난다 (다시 로그인) */
  async resetPassword(req: OwnerResetInput, ip: string): Promise<void> {
    const email = OwnerMailService.address(req.email);
    this.checkCode(`reset:${email}`, req.code, ip);
    this.passwords.check(email, req.password);
    const hash = await this.hasher.hash(req.password);
    await this.transaction(async (tx) => {
      const owners = new OwnerRepository(tx);
      const owner = await owners.findByLogin(email);
      if (!owner?.usesEmail(email))
        throw new InvalidRequest(new Map([['code', OwnerMailService.WRONG_CODE]]));
      owner.setPassword(hash, null, new Date(), 'mail');
      await owners.save(owner);
    });
    this.codes.use(`reset:${email}`);
  }

  /** 로그인 메일로 쓸 주소에 인증코드를 보낸다 (관리자만, 로그인한 콘솔에서) */
  async sendEmailCode(actor: Actor, req: OwnerCodeInput, ip: string): Promise<void> {
    actor.assertOwner();
    const email = OwnerMailService.address(req.email);
    this.mail.assertReady();
    this.sends.hit(AttemptLimiter.place(ip));
    const code = this.codes.issue(`email:${email}`);
    this.mail.post(
      email,
      `[Moida] 로그인 메일 확인 인증코드 ${code}`,
      [
        `관리자 로그인 메일 확인 인증코드: ${code}`,
        '',
        `${VerifyCodes.TTL_MS / 60_000}분 안에 콘솔 › 설정 › 보안에 넣어 주세요.`,
        '요청하지 않았다면 이 메일을 무시하세요.',
      ].join('\n'),
    );
  }

  /** 로그인 메일을 바꾼다: 새 메일로 받은 코드와 지금 비밀번호가 맞아야 한다. 로그인은 그대로 */
  async changeEmail(
    actor: Actor,
    token: string | null,
    req: OwnerEmailInput,
    ip: string,
  ): Promise<Owner> {
    if (actor.kind !== 'owner' || !token) throw new Unauthenticated('로그인해 주세요');
    const tokenHash = WebSession.hash(token);
    const found = await new OwnerRepository(this.db.sql).findBySession(tokenHash);
    if (!found) throw new Unauthenticated('로그인해 주세요');
    const email = OwnerMailService.address(req.email);
    if (!(await this.hasher.verify(req.password, found.passwordHash))) {
      this.wrong.fail(AttemptLimiter.place(ip));
      throw new InvalidRequest(new Map([['password', '지금 비밀번호를 다시 확인해 주세요']]));
    }
    this.checkCode(`email:${email}`, req.code, ip);
    const owner = await this.transaction(async (tx) => {
      const owners = new OwnerRepository(tx);
      const current = await owners.findBySession(tokenHash);
      if (!current) throw new Unauthenticated('로그인해 주세요');
      if (!current.usesEmail(email) && (await owners.findByLogin(email)))
        throw new Conflict('이미 쓰는 메일이에요');
      current.useEmail(email);
      await owners.save(current);
      return current;
    });
    this.codes.use(`email:${email}`);
    return owner;
  }

  /** 코드가 맞는가. 틀리면 곳마다 세고 400 (코드는 VerifyCodes가 5번 틀리면 버린다) */
  private checkCode(key: string, code: string, ip: string): void {
    const place = AttemptLimiter.place(ip);
    this.wrong.check(place);
    if (this.codes.check(key, code)) return;
    this.wrong.fail(place);
    throw new InvalidRequest(new Map([['code', OwnerMailService.WRONG_CODE]]));
  }

  private static address(raw: string): string {
    const email = EmailAddress.clean(raw);
    if (!email) throw new InvalidRequest(new Map([['email', '메일 주소 모양이 아니에요']]));
    return email;
  }
}
