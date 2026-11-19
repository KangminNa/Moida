import { cookies, headers } from 'next/headers';

// 서버 컴포넌트에서 서버 API 부르기. 브라우저의 쿠키(로그인·설치 통행증)를 그대로 넘겨 같은 사람으로 묻는다.
// 앞의 프록시가 붙인 x-forwarded-for도 넘긴다: 서버가 보안 화면의 마지막 접근에 웹 서버의 주소가 아니라 브라우저의 주소를 적게.
// 웹은 DB에 직접 닿지 않는다 (AGENTS.md 코드 규칙).
const BASE = process.env.API_URL ?? 'http://localhost:4000';

/** 응답 하나: 상태 코드와 본문 (연결 실패면 status 0) */
export type ServerReply<T> = { status: number; data: T | null };

/**
 * asVisitor: 쿠키를 넘기지 않고 방문자로 묻는다 (방문자 화면은 주인이 열어도 방문자가 보는 그대로).
 * host: 앱 도메인으로 온 요청처럼 묻는다 (X-Forwarded-Host, 커뮤니티 회원 API는 앱 도메인에서만 열린다, 스토어 3-2).
 * 앱 도메인의 브라우저 쿠키는 그 도메인의 것(회원 쿠키)뿐이라 그대로 넘긴다
 */
export async function serverFetch<T>(
  path: string,
  asVisitor = false,
  host: string | null = null,
): Promise<ServerReply<T>> {
  const jar = await cookies();
  const cookie = asVisitor
    ? ''
    : jar
        .getAll()
        .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
        .join('; ');
  const forwarded = (await headers()).get('x-forwarded-for');
  try {
    const res = await fetch(`${BASE}${path}`, {
      cache: 'no-store',
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(forwarded ? { 'x-forwarded-for': forwarded } : {}),
        ...(host ? { 'x-forwarded-host': host } : {}),
      },
    });
    return { status: res.status, data: (await res.json().catch(() => null)) as T | null };
  } catch {
    return { status: 0, data: null };
  }
}

/** 성공하면 본문, 실패(401·404 등)나 연결 실패면 null */
export async function serverGet<T>(
  path: string,
  asVisitor = false,
  host: string | null = null,
): Promise<T | null> {
  const reply = await serverFetch<T>(path, asVisitor, host);
  return reply.status >= 200 && reply.status < 300 ? reply.data : null;
}

/** 서버의 답을 그대로 (파일을 흘려보낼 때). 방문자로 묻는다. 연결 실패면 null */
export async function serverRaw(path: string): Promise<Response | null> {
  try {
    return await fetch(`${BASE}${path}`, { cache: 'no-store' });
  } catch {
    return null;
  }
}
