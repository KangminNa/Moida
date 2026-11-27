import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Cookies, Forbidden, type HttpRequest } from '../../platform';
import { AccountService } from '../account/account.service';
import { AccountSession } from '../account/account-session';
import { MemberPlace } from '../member/member.input';
import { MemberQuery } from '../member/member.query';
import { MemberCsrf } from '../member/member-csrf.policy';

// 커뮤니티 회원 API의 요청자 (스토어 3-1, 원칙 10). 커뮤니티 컨트롤러에만 붙고, 전체 요청자(account ActorGuard) 다음에 돈다.
// 앱 도메인 요청(HostGate의 appId)에서만 회원 쿠키를 읽어 MemberActor(로그인한 스토어 계정 + 이 앱의 회원)로 정한다: 기본 도메인에서는 회원 쿠키를 보지 않고,
// 앱 도메인에서는 관리자 쿠키를 보지 않는다 (ActorGuard). 그래서 회원은 관리 API에, 관리자 로그인은 회원 API에 닿지 않는다.
// 쓰기(POST · PATCH · DELETE)는 세 겹으로 본다 (11.1 세션 탈취 · CSRF):
//   다른 사이트에서 온 요청(Sec-Fetch-Site: cross-site)은 403, Origin이 있으면 이 앱 도메인의 출처여야 하고,
//   회원 쿠키를 실었으면 X-Cairn-CSRF가 그 쿠키의 확인 값(MemberCsrf)이어야 한다 (쿠키가 없으면 훔칠 로그인이 없다).
//   가입 · 로그인은 쿠키 없이 오므로 앞의 둘이 지킨다: 다른 사이트가 남의 브라우저를 자기 계정으로 로그인시키지 못하게.
//   본문은 JSON만 읽는다 (HttpSetup): 다른 사이트의 폼은 JSON을 보내지 못하고, fetch는 CORS를 열지 않아 막힌다
@Injectable()
export class MemberGuard implements CanActivate {
  private static readonly READS = new Set(['GET', 'HEAD', 'OPTIONS']);

  constructor(
    private readonly query: MemberQuery,
    private readonly accounts: AccountService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    // 공통 앱 도메인의 앱 없는 요청(api/store의 로그인 · 로그아웃 · me, 2026-11-27)도 쓰기는 같은 세 겹으로 본다.
    // 요청자는 만들지 않는다 (앱이 없어 회원이 아니다): 그 API가 쿠키로 계정을 직접 읽는다
    if (request.appId === undefined && request.appsDomain !== true) return true;
    const token = Cookies.read(request, AccountSession.COOKIE);
    if (!MemberGuard.READS.has(request.method.toUpperCase())) this.assertSameSite(request, token);
    if (!token || request.appId === undefined) return true;
    const member = await this.query.actorFor(token, request.appId, request.appsDomain === true);
    if (!member) return true;
    request.actor = member;
    await this.accounts.seen(token, new Date());
    return true;
  }

  private assertSameSite(request: HttpRequest, cookie: string | null): void {
    const origin = request.headers.origin;
    if (String(request.headers['sec-fetch-site'] ?? '') === 'cross-site')
      throw new Forbidden('origin', '이 커뮤니티에서 연 화면에서만 쓸 수 있어요');
    if (typeof origin === 'string' && origin !== MemberPlace.originOf(request))
      throw new Forbidden('origin', '이 커뮤니티에서 연 화면에서만 쓸 수 있어요');
    if (cookie && !this.query.csrfMatches(cookie, request.headers[MemberCsrf.HEADER]))
      throw new Forbidden('csrf', '화면을 새로 고친 뒤 다시 해 주세요');
  }
}
