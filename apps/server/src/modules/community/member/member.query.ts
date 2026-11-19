import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BaseQuery,
  Database,
  type LoginMethod,
  Lookups,
  MemberActor,
  NotFound,
  PluginRegistry,
  SecretBox,
} from '../../platform';
import { members } from '../community.schema';
import { JoinTicket } from './join-ticket';
import { Member } from './member';
import { MemberCallbackInput, type MemberPlace, type MemberStartInput } from './member.input';
import {
  MemberLoginMethodListView,
  MemberMeView,
  MemberSelfView,
  MemberStartView,
} from './member.view';
import { MemberCsrf } from './member-csrf.policy';
import { MemberSession } from './member-session';

// 회원 읽기 (스토어 3-1): 이 브라우저가 누구인지 · 회원 로그인 버튼 · 로그인 시작 주소, 그리고 회원 쿠키 → 요청자(MemberGuard).
// 모두 앱 도메인의 공개된 커뮤니티 앱에서만 (blog가 Lookups 'community-app'으로 알려 준다). 아니면 없는 주소와 같다
@Injectable()
export class MemberQuery extends BaseQuery {
  private readonly csrf: MemberCsrf;

  constructor(
    db: Database,
    private readonly box: SecretBox,
    private readonly lookups: Lookups,
    private readonly registry: PluginRegistry,
  ) {
    super(db);
    this.csrf = new MemberCsrf(box);
  }

  /** 회원 쿠키의 요청자 (MemberGuard가 부른다). 그 앱의 끝나지 않은 세션만, 아니면 null */
  async actorFor(token: string, appId: string): Promise<MemberActor | null> {
    const [row] = await this.sql<{ id: string }[]>`
      SELECT m.id FROM community.member_sessions s
      JOIN community.members m ON m.id = s.member_id
      WHERE s.token_hash = ${MemberSession.hash(token)} AND s.ended_at IS NULL
        AND s.expires_at > now() AND m.app_id = ${appId}`;
    return row ? new MemberActor(appId, row.id) : null;
  }

  /**
   * 이 브라우저가 누구인가: 로그인한 회원이면 자기 정보, 가입 중이면 joining. csrf는 지금 가진 쿠키(회원 · 가입 표)로 만든
   * 쓰기 요청의 확인 값이다 (MemberCsrf)
   */
  async me(
    actor: Actor,
    place: MemberPlace,
    memberCookie: string | null,
    joinCookie: string | null,
  ): Promise<MemberMeView> {
    await this.assertCommunity(actor, place);
    if (actor instanceof MemberActor && memberCookie) {
      const row = await this.row(members, { id: actor.id ?? '', app_id: place.appId });
      if (row) {
        const writable = new Date(row.joined_at.getTime() + Member.JOIN_WAIT_MS);
        return new MemberMeView(
          new MemberSelfView(row, writable),
          false,
          this.csrf.tokenOf(memberCookie),
        );
      }
    }
    const ticket = JoinTicket.open(this.box, joinCookie, place.appId);
    if (ticket) return new MemberMeView(null, true, this.csrf.tokenOf(ticket.cookie));
    return new MemberMeView(null, false, null);
  }

  /** 회원 로그인 버튼들: 켜진 로그인 플러그인 중 회원용 (login-kakao) */
  async methods(actor: Actor, place: MemberPlace): Promise<MemberLoginMethodListView> {
    await this.assertCommunity(actor, place);
    return new MemberLoginMethodListView(
      this.registry.memberLogins().map((l) => [l.name, l.login.label] as const),
    );
  }

  /** 로그인 시작: 그 서비스로 보낼 주소와, 돌아올 때 맞춰 볼 상태 쿠키 */
  async start(actor: Actor, place: MemberPlace, req: MemberStartInput): Promise<MemberStartView> {
    await this.assertCommunity(actor, place);
    const method = this.method(req.method);
    const state = randomBytes(16).toString('base64url');
    return new MemberStartView(
      method.login.start(place.callbackUrl(method.name), state),
      MemberCallbackInput.cookieFor(this.box, state, req, place.appId),
    );
  }

  /** 쓰기 요청의 확인 값이 이 쿠키의 것과 맞는가 (MemberGuard) */
  csrfMatches(cookie: string, token: unknown): boolean {
    return this.csrf.matches(cookie, token);
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
