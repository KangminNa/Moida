import { Injectable, Logger } from '@nestjs/common';
import {
  type Actor,
  BaseService,
  Database,
  type LoginMethod,
  Lookups,
  MemberActor,
  NotFound,
  PluginRegistry,
  SecretBox,
  Unauthenticated,
} from '../../platform';
import { JoinTicket } from './join-ticket';
import { Member } from './member';
import type { JoinInput, MemberCallbackInput, MemberPlace, RenameInput } from './member.input';
import { MemberRepository } from './member.repository';
import { MemberSession } from './member-session';

// 회원 쓰기 (스토어 3-1): 소셜 로그인을 마치기(아는 회원이면 로그인, 처음이면 가입 표) · 가입 · 닉네임 바꾸기 · 로그아웃 · 마지막 접근.
// 소셜 로그인 서비스와의 요청(login.finish)은 트랜잭션 밖에서. 모두 앱 도메인의 공개된 커뮤니티 앱에서만
@Injectable()
export class MemberService extends BaseService {
  private static readonly TOUCHED_MAX = 10_000;
  private readonly logger = new Logger('회원');
  /** 마지막 접근을 적은 때 (세션 해시 → ms). 요청마다 쓰지 않게 */
  private readonly touched = new Map<string, number>();

  constructor(
    db: Database,
    private readonly box: SecretBox,
    private readonly lookups: Lookups,
    private readonly registry: PluginRegistry,
  ) {
    super(db);
  }

  /** 소셜 로그인을 마친다: 그 회원 번호의 회원이 있으면 새 로그인, 없으면 가입 표 (서버에는 남기지 않는다) */
  async signIn(
    actor: Actor,
    place: MemberPlace,
    req: MemberCallbackInput,
  ): Promise<MemberSession | JoinTicket> {
    await this.assertCommunity(actor, place);
    const method = this.method(req.method);
    const identity = await method.login.finish(req.query, place.callbackUrl(method.name));
    const now = new Date();
    return this.transaction(async (tx) => {
      const members = new MemberRepository(tx);
      const member = await members.findByLogin(place.appId, method.name, identity.subject);
      if (!member)
        return JoinTicket.issue(this.box, place.appId, method.name, identity.subject, req.returnTo);
      const session = member.startSession(now);
      await members.save(member);
      return session;
    });
  }

  /** 가입: 가입 표의 로그인으로 회원 · 로그인 · 첫 세션을 함께 만든다. 가입 표가 없으면 401 */
  async join(
    actor: Actor,
    place: MemberPlace,
    req: JoinInput,
    ticket: JoinTicket | null,
  ): Promise<Member> {
    if (!ticket) throw new Unauthenticated('로그인부터 해 주세요 (15분 안에 가입해요)');
    await this.assertCommunity(actor, place);
    const member = Member.join(
      place.appId,
      req.nickname,
      req.ageConfirmed,
      ticket.method,
      ticket.subject,
      new Date(),
    );
    await this.transaction((tx) => new MemberRepository(tx).save(member));
    return member;
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

  private method(name: string): LoginMethod {
    const found = this.registry.memberLogin(name);
    if (!found) throw new NotFound(`켜지 않은 로그인 방법이에요: ${name}`);
    return found;
  }

  private assertCommunity(actor: Actor, place: MemberPlace): Promise<void> {
    return this.lookups.assertVisible('community-app', actor, [place.appId], '없는 주소예요');
  }
}
