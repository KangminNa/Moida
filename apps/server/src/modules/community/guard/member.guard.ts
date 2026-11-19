import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Cookies, Forbidden, type HttpRequest } from '../../platform';
import { JoinTicket } from '../member/join-ticket';
import { MemberPlace } from '../member/member.input';
import { MemberQuery } from '../member/member.query';
import { MemberService } from '../member/member.service';
import { MemberCsrf } from '../member/member-csrf.policy';
import { MemberSession } from '../member/member-session';

// 커뮤니티 회원 API의 요청자 (스토어 3-1, 원칙 10). 커뮤니티 컨트롤러에만 붙고, 전체 요청자(account ActorGuard) 다음에 돈다.
// 앱 도메인 요청(HostGate의 appId)에서만 회원 쿠키를 읽어 MemberActor로 정한다: 기본 도메인에서는 회원 쿠키를 보지 않고,
// 앱 도메인에서는 관리자 쿠키를 보지 않는다 (ActorGuard). 그래서 회원은 관리 API에, 관리자 로그인은 회원 API에 닿지 않는다.
// 쓰기(POST · PATCH · DELETE)는 세 겹으로 본다 (11.1 세션 탈취 · CSRF):
//   다른 사이트에서 온 요청(Sec-Fetch-Site: cross-site)은 403, Origin이 있으면 이 앱 도메인의 출처여야 하고,
//   회원 · 가입 표 쿠키를 실었으면 X-Cairn-CSRF가 그 쿠키의 확인 값(MemberCsrf)이어야 한다 (쿠키가 없으면 훔칠 로그인이 없다)
@Injectable()
export class MemberGuard implements CanActivate {
  private static readonly READS = new Set(['GET', 'HEAD', 'OPTIONS']);

  constructor(
    private readonly query: MemberQuery,
    private readonly members: MemberService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    if (request.appId === undefined) return true;
    const token = Cookies.read(request, MemberSession.COOKIE);
    if (!MemberGuard.READS.has(request.method.toUpperCase()))
      this.assertSameSite(request, token ?? Cookies.read(request, JoinTicket.COOKIE));
    if (!token) return true;
    const member = await this.query.actorFor(token, request.appId);
    if (!member) return true;
    request.actor = member;
    await this.members.seen(token, new Date());
    return true;
  }

  private assertSameSite(request: HttpRequest, cookie: string | null): void {
    const origin = request.headers.origin;
    if (String(request.headers['sec-fetch-site'] ?? '') === 'cross-site')
      throw new Forbidden('origin', '이 커뮤니티에서 연 화면에서만 쓸 수 있어요');
    if (typeof origin === 'string' && origin !== MemberPlace.from(request).origin)
      throw new Forbidden('origin', '이 커뮤니티에서 연 화면에서만 쓸 수 있어요');
    if (cookie && !this.query.csrfMatches(cookie, request.headers[MemberCsrf.HEADER]))
      throw new Forbidden('csrf', '화면을 새로 고친 뒤 다시 해 주세요');
  }
}
