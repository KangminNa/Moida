import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, Database, Lookups, MemberActor, SecretBox } from '../../platform';
import { AccountSession } from '../account/account-session';
import { accounts, members } from '../community.schema';
import { Member } from './member';
import type { MemberPlace } from './member.input';
import { AccountSelfView, MemberMeView, MemberSelfView } from './member.view';
import { MemberCsrf } from './member-csrf.policy';

// 회원 읽기 (스토어 3-1, 스토어 계정 2026-11-26): 이 브라우저가 누구인지(계정과 이 앱의 회원), 그리고 회원 쿠키 → 요청자(MemberGuard).
// 모두 앱 도메인의 회원을 받는 공개 앱에서만 (blog가 Lookups 'member-app'으로 알려 준다: 커뮤니티 앱과 선언서에 members를 적은 앱, 스토어 12.3). 아니면 없는 주소와 같다
@Injectable()
export class MemberQuery extends BaseQuery {
  private readonly csrf: MemberCsrf;

  constructor(
    db: Database,
    box: SecretBox,
    private readonly lookups: Lookups,
  ) {
    super(db);
    this.csrf = new MemberCsrf(box);
  }

  /**
   * 회원 쿠키의 요청자 (MemberGuard가 부른다): 그 앱 도메인에 열린 끝나지 않은 세션의 계정 (탈퇴 · 정지가 아닌),
   * 그 계정이 이 앱에 참여했으면 그 회원까지. 아니면 null.
   * shared: 공통 앱 도메인으로 온 요청 (2026-11-27). 그 도메인의 앱들은 회원 쿠키 하나를 함께 쓰므로 어느 앱에서 연 세션이든
   * 이 앱의 로그인으로 친다 (로그인 한 번으로 모든 앱). 쿠키는 그 도메인에만 실려 다른 도메인 앱의 세션이 섞이지 않는다
   */
  async actorFor(token: string, appId: string, shared = false): Promise<MemberActor | null> {
    const [row] = await this.sql<{ account_id: string; member_id: string | null }[]>`
      SELECT a.id AS account_id, m.id AS member_id FROM community.account_sessions s
      JOIN community.accounts a ON a.id = s.account_id
      LEFT JOIN community.members m ON m.account_id = a.id AND m.app_id = ${appId}
      WHERE s.token_hash = ${AccountSession.hash(token)} AND s.ended_at IS NULL
        AND s.expires_at > now() AND (s.app_id = ${appId} OR ${shared}) AND a.left_at IS NULL
        AND (a.suspended_until IS NULL OR a.suspended_until <= now())`;
    return row ? new MemberActor(appId, row.member_id, row.account_id) : null;
  }

  /**
   * 이 브라우저가 누구인가: 로그인한 계정 · 이 앱의 회원(참여 전이면 null)과 쓰기 요청의 확인 값(회원 쿠키로 만든 MemberCsrf).
   * 쿠키가 없으면 모두 null
   */
  async me(actor: Actor, place: MemberPlace, memberCookie: string | null): Promise<MemberMeView> {
    await this.lookups.assertVisible('member-app', actor, [place.appId], '없는 주소예요');
    if (!memberCookie) return new MemberMeView(null, null, null);
    // 쿠키를 실은 쓰기는 이 값이 있어야 한다 (MemberGuard): 끝난 로그인의 쿠키가 남은 브라우저(비밀번호 초기화 · 30일)도
    // 이 값을 실어 다시 로그인 · 가입할 수 있게, 로그인이 없어도 쿠키의 값을 준다
    const csrf = this.csrf.tokenOf(memberCookie);
    if (!(actor instanceof MemberActor) || actor.appId !== place.appId)
      return new MemberMeView(null, null, csrf);
    const account = await this.row(accounts, { id: actor.accountId, space_id: place.spaceId });
    if (!account) return new MemberMeView(null, null, csrf);
    const member =
      actor.id === null ? null : await this.row(members, { id: actor.id, app_id: place.appId });
    const self = member
      ? new MemberSelfView(member, new Date(member.joined_at.getTime() + Member.JOIN_WAIT_MS))
      : null;
    return new MemberMeView(new AccountSelfView(account), self, csrf);
  }

  /** 쓰기 요청의 확인 값이 이 쿠키의 것과 맞는가 (MemberGuard) */
  csrfMatches(cookie: string, token: unknown): boolean {
    return this.csrf.matches(cookie, token);
  }
}
