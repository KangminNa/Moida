import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, Database, Lookups, MemberActor, SecretBox } from '../../platform';
import { members } from '../community.schema';
import { Member } from './member';
import type { MemberPlace } from './member.input';
import { MemberMeView, MemberSelfView } from './member.view';
import { MemberCsrf } from './member-csrf.policy';
import { MemberSession } from './member-session';

// 회원 읽기 (스토어 3-1): 이 브라우저가 누구인지, 그리고 회원 쿠키 → 요청자(MemberGuard).
// 모두 앱 도메인의 공개된 커뮤니티 앱에서만 (blog가 Lookups 'community-app'으로 알려 준다). 아니면 없는 주소와 같다
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

  /** 회원 쿠키의 요청자 (MemberGuard가 부른다). 그 앱의 끝나지 않은 세션만, 아니면 null */
  async actorFor(token: string, appId: string): Promise<MemberActor | null> {
    const [row] = await this.sql<{ id: string }[]>`
      SELECT m.id FROM community.member_sessions s
      JOIN community.members m ON m.id = s.member_id
      WHERE s.token_hash = ${MemberSession.hash(token)} AND s.ended_at IS NULL
        AND s.expires_at > now() AND m.app_id = ${appId}`;
    return row ? new MemberActor(appId, row.id) : null;
  }

  /** 이 브라우저가 누구인가: 로그인한 회원이면 자기 정보와 쓰기 요청의 확인 값(회원 쿠키로 만든 MemberCsrf), 아니면 둘 다 null */
  async me(actor: Actor, place: MemberPlace, memberCookie: string | null): Promise<MemberMeView> {
    await this.assertCommunity(actor, place);
    if (!memberCookie) return new MemberMeView(null, null);
    // 쿠키를 실은 쓰기는 이 값이 있어야 한다 (MemberGuard): 끝난 로그인의 쿠키가 남은 브라우저(비밀번호 초기화 · 30일)도
    // 이 값을 실어 다시 로그인 · 가입할 수 있게, 로그인이 없어도 쿠키의 값을 준다
    const csrf = this.csrf.tokenOf(memberCookie);
    if (!(actor instanceof MemberActor)) return new MemberMeView(null, csrf);
    const row = await this.row(members, { id: actor.id ?? '', app_id: place.appId });
    if (!row) return new MemberMeView(null, csrf);
    const writable = new Date(row.joined_at.getTime() + Member.JOIN_WAIT_MS);
    return new MemberMeView(new MemberSelfView(row, writable), csrf);
  }

  /** 쓰기 요청의 확인 값이 이 쿠키의 것과 맞는가 (MemberGuard) */
  csrfMatches(cookie: string, token: unknown): boolean {
    return this.csrf.matches(cookie, token);
  }

  private assertCommunity(actor: Actor, place: MemberPlace): Promise<void> {
    return this.lookups.assertVisible('community-app', actor, [place.appId], '없는 주소예요');
  }
}
