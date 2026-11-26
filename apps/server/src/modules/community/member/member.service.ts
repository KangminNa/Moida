import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BaseService,
  Conflict,
  Database,
  InvalidRequest,
  Lookups,
  MemberActor,
  PasswordHasher,
} from '../../platform';
import { AccountRepository } from '../account/account.repository';
import { TermsQuery } from '../terms/terms.query';
import { TermsConsent } from '../terms/terms-consent.policy';
import { Member } from './member';
import type { EnterInput, LeaveInput, MemberPlace, RenameInput } from './member.input';
import { MemberRepository } from './member.repository';

// 앱 회원 쓰기 (스토어 3-1, 스토어 계정 2026-11-26): 로그인한 계정의 앱 참여 · 닉네임 바꾸기 · 이 앱에서 나가기.
// 가입(계정 + 첫 앱 참여)은 AccountMailService, 로그인 · 비밀번호 · 계정 탈퇴는 AccountService.
// 모두 앱 도메인의 회원을 받는 공개 앱에서만 (Lookups 'member-app': 커뮤니티 앱과 선언서에 members를 적은 앱, 스토어 12.3)
@Injectable()
export class MemberService extends BaseService {
  constructor(
    db: Database,
    private readonly lookups: Lookups,
    private readonly hasher: PasswordHasher,
    private readonly terms: TermsQuery,
  ) {
    super(db);
  }

  /**
   * 앱 참여: 로그인한 계정이 이 앱의 회원이 된다 (닉네임은 이 앱의 것). 이 앱이 약관을 공개했으면 그 버전에 동의하고,
   * 계정이 아직 공통 약관에 동의하지 않았으면(옮겨 온 옛 계정) 그 버전도. 이미 참여했으면 409. 잠그는 순서는 계정 → 회원
   */
  async enter(actor: Actor, place: MemberPlace, req: EnterInput): Promise<Member> {
    const me = MemberActor.requireAccount(actor, place.appId);
    await this.assertApp(actor, place);
    if (me.id !== null) throw new Conflict('이미 참여한 앱이에요');
    const store = await this.terms.versions(actor, { spaceId: place.spaceId });
    const app = await this.terms.versions(actor, { appId: place.appId });
    return this.transaction(async (tx) => {
      const accounts = new AccountRepository(tx);
      const account = await accounts.lock(place.spaceId, me.accountId);
      TermsConsent.check(store, app, req.agreement, !account.agreed);
      const now = new Date();
      if (!account.agreed) {
        account.agree(req.agreement.termsVersion ?? 0, req.agreement.privacyVersion ?? 0);
        await accounts.save(account);
      }
      const member = Member.enter(
        place.appId,
        account.id,
        req.nickname,
        account.ageConfirmedAt,
        now,
      );
      member.agree(req.agreement.appTermsVersion, req.agreement.appPrivacyVersion);
      await new MemberRepository(tx).save(member);
      return member;
    });
  }

  /** 닉네임 바꾸기 (그 회원만) */
  async rename(actor: Actor, place: MemberPlace, req: RenameInput): Promise<Member> {
    const me = MemberActor.require(actor, place.appId);
    await this.assertApp(actor, place);
    return this.transaction(async (tx) => {
      const members = new MemberRepository(tx);
      const member = await members.lock(place.appId, me.id);
      member.assertVersion(req.version);
      member.rename(req.nickname, new Date());
      await members.save(member);
      return member;
    });
  }

  /**
   * 이 앱에서 나가기 (그 회원만, 3-4): 계정 비밀번호가 맞아야 한다. 이 앱의 닉네임 · 계정 연결을 지우고(Member.leave)
   * 글 · 댓글은 "탈퇴한 회원"으로 남는다. 계정과 로그인은 그대로다 (다른 앱은 계속 쓴다). 차단 중이어도 나갈 수 있다
   */
  async leave(actor: Actor, place: MemberPlace, req: LeaveInput): Promise<void> {
    const me = MemberActor.require(actor, place.appId);
    const account = await this.transaction((tx) =>
      new AccountRepository(tx).load(place.spaceId, me.accountId),
    );
    if (!(await this.hasher.verify(req.password, account.passwordHash)))
      throw new InvalidRequest(new Map([['password', '비밀번호가 맞지 않아요']]));
    await this.transaction(async (tx) => {
      const members = new MemberRepository(tx);
      const member = await members.lock(place.appId, me.id);
      member.leave(new Date());
      await members.save(member);
    });
  }

  private assertApp(actor: Actor, place: MemberPlace): Promise<void> {
    return this.lookups.assertVisible('member-app', actor, [place.appId], '없는 주소예요');
  }
}
