import type { HttpRequest, HttpResponse } from './http-types';

// 쿠키 읽기·쓰기. 라이브러리 없이: 읽기는 Cookie 머리글을 나누고, 쓰기는 Express의 res.cookie를 쓴다.
// 로그인·설치 통행증처럼 서버만 읽는 값이라 모두 httpOnly, SameSite=Lax.
// Secure(https에서만 보내기): 요청이 https(앞단 프록시가 X-Forwarded-Proto로 알린 것 포함, trust proxy)이거나
// 사람이 여는 웹 주소(MOIDA_WEB_URL, 운영 배포에서 정한다)가 https면 늘 (웹 보안 S2: 프록시가 https를 알려 주지 않아도 빠지지 않게).
// 개발(http://localhost)에서는 붙이지 않는다: 붙이면 브라우저가 http에서 쿠키를 받지 않는다.
// https면 이름 앞에 __Host-를 붙인다 (3-5 보안 검토, 2026-11-27): 브라우저는 Secure · Path=/ · Domain 없이 이 서버가 준 것만
// 그 이름으로 받는다. 그래서 하위 도메인(공통 앱 도메인 apps.<사이트> · 앱의 자기 도메인)의 스크립트가 Domain=<사이트>로
// 같은 이름의 쿠키를 심어 관리자 · 회원 로그인을 덮거나 바꿔치지(cookie tossing) 못한다. 읽기는 __Host- 이름을 먼저, https면 그것만 본다
// biome-ignore lint/complexity/noStaticOnlyClass: 진입 계층(Controller·Guard)이 함께 쓰는 쿠키 규칙 한 곳
export class Cookies {
  static read(request: Pick<HttpRequest, 'headers' | 'protocol'>, name: string): string | null {
    const header = request.headers.cookie;
    if (typeof header !== 'string') return null;
    // __Host- 이름은 언제나(하위 도메인이 심을 수 없다), 앞머리 없는 이름은 http일 때만 (웹이 서버를 부르는 안쪽 http 요청도 같은 규칙)
    const values = new Map<string, string>();
    for (const part of header.split(';')) {
      const at = part.indexOf('=');
      if (at < 0) continue;
      const key = part.slice(0, at).trim();
      if (!values.has(key)) values.set(key, decodeURIComponent(part.slice(at + 1).trim()));
    }
    const pick = (n: string) =>
      values.get(`__Host-${n}`) ?? (Cookies.secure(request) ? null : (values.get(n) ?? null));
    return pick(name) ?? (Cookies.legacy(name) ? pick(Cookies.legacy(name) as string) : null);
  }

  /**
   * 옛 이름 (2026-11-28 이름 cairn → moida): 그 전에 준 쿠키(cairn_session · cairn_member …)도 끝날 때까지 읽는다.
   * 새로 줄 때는 새 이름만, 지울 때는 둘 다 지운다
   */
  private static legacy(name: string): string | null {
    return name.startsWith('moida_') ? `cairn_${name.slice('moida_'.length)}` : null;
  }

  static set(
    response: HttpResponse,
    request: HttpRequest,
    name: string,
    value: string,
    maxAgeSeconds: number,
  ): void {
    response.cookie(Cookies.nameOf(request, name), value, {
      httpOnly: true,
      sameSite: 'lax',
      secure: Cookies.secure(request),
      path: '/',
      maxAge: maxAgeSeconds * 1000,
    });
  }

  /** https로 왔거나 사이트가 https인가: 쿠키에 Secure와 __Host- 앞머리를 붙인다 */
  private static secure(request: Pick<HttpRequest, 'protocol'>): boolean {
    return request.protocol === 'https' || Cookies.httpsSite();
  }

  /** 실제 쿠키 이름: https면 __Host-<이름> */
  private static nameOf(request: Pick<HttpRequest, 'protocol'>, name: string): string {
    return Cookies.secure(request) ? `__Host-${name}` : name;
  }

  /** 사람이 여는 웹 주소가 https인가 (MOIDA_WEB_URL). 부를 때마다 읽는다 (테스트가 바꿔 본다) */
  private static httpsSite(): boolean {
    return (process.env.MOIDA_WEB_URL ?? process.env.CAIRN_WEB_URL ?? '').startsWith('https://');
  }

  static clear(response: HttpResponse, request: HttpRequest, name: string): void {
    const secure = Cookies.secure(request);
    const old = Cookies.legacy(name);
    for (const n of old ? [name, old] : [name])
      response.clearCookie(Cookies.nameOf(request, n), {
        path: '/',
        secure,
        httpOnly: true,
        sameSite: 'lax',
      });
  }
}
