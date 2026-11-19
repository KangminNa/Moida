import type { HttpRequest, HttpResponse } from './http-types';

// 쿠키 읽기·쓰기. 라이브러리 없이: 읽기는 Cookie 머리글을 나누고, 쓰기는 Express의 res.cookie를 쓴다.
// 로그인·설치 통행증처럼 서버만 읽는 값이라 모두 httpOnly, SameSite=Lax.
// Secure(https에서만 보내기): 요청이 https(앞단 프록시가 X-Forwarded-Proto로 알린 것 포함, trust proxy)이거나
// 사람이 여는 웹 주소(CAIRN_WEB_URL, 운영 배포에서 정한다)가 https면 늘 (웹 보안 S2: 프록시가 https를 알려 주지 않아도 빠지지 않게).
// 개발(http://localhost)에서는 붙이지 않는다: 붙이면 브라우저가 http에서 쿠키를 받지 않는다
// biome-ignore lint/complexity/noStaticOnlyClass: 진입 계층(Controller·Guard)이 함께 쓰는 쿠키 규칙 한 곳
export class Cookies {
  static read(request: Pick<HttpRequest, 'headers'>, name: string): string | null {
    const header = request.headers.cookie;
    if (typeof header !== 'string') return null;
    for (const part of header.split(';')) {
      const at = part.indexOf('=');
      if (at < 0) continue;
      if (part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
    }
    return null;
  }

  static set(
    response: HttpResponse,
    request: HttpRequest,
    name: string,
    value: string,
    maxAgeSeconds: number,
  ): void {
    response.cookie(name, value, {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.protocol === 'https' || Cookies.httpsSite(),
      path: '/',
      maxAge: maxAgeSeconds * 1000,
    });
  }

  /** 사람이 여는 웹 주소가 https인가 (CAIRN_WEB_URL). 부를 때마다 읽는다 (테스트가 바꿔 본다) */
  private static httpsSite(): boolean {
    return (process.env.CAIRN_WEB_URL ?? '').startsWith('https://');
  }

  static clear(response: HttpResponse, name: string): void {
    response.clearCookie(name, { path: '/' });
  }
}
