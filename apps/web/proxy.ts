import { type NextRequest, NextResponse } from 'next/server';
import { appOfHost } from './app/_blog/app-domains';
import { appsOrigin, isAppsHost } from './app/_blog/apps-domain';
import { appsPathKind, isAppsMemberScreen, movesToApps } from './app/_blog/apps-paths';
import { hostOf } from './app/_blog/request-host';
import { RETURN_HEADER } from './app/_lib/return-path';
import { isAppScreenRoot, isMemberScreen, SCREEN_HEADERS } from './app/_lib/screen-headers';

// 화면 요청이 지나는 곳. 아래 일을 한다.
// 0. 공통 앱 도메인 (CAIRN_APPS_URL, 2026-11-27, apps-paths.ts): 그 도메인의 / 는 스토어 첫 화면, 앱은 /<앱>/…,
//    콘솔 · 로그인 같은 웹의 화면은 없는 주소. 기본 도메인의 / 와 앱 주소는 그 도메인으로 넘긴다 (308, 미리 보기 · 콘솔은 그대로)
// 1. 앱 도메인 (스토어 3-0): 연결을 확인한 앱 도메인으로 온 요청은 그 앱의 주소(/<앱>/…)로 넘긴다 (rewrite: 주소창은 그대로).
//    그래서 앱 도메인에서는 앱 화면 · 앱 파일 · 앱 RSS만 열리고, 콘솔 · 로그인 같은 웹의 화면은 그 앱 안의 없는 주소가 된다.
//    /api · /.well-known · /_next는 여기를 지나지 않는다 (서버로 넘기거나 Next가 낸다. 앱 도메인의 /api는 서버의 HostGate가 거른다).
//    /mcp · /oauth도 앱 도메인에서는 그 앱 안의 없는 주소가 된다 (기본 도메인에서는 그대로 서버로 넘어간다).
//    앱 도메인의 응답에는 화면 머리글을 붙이지 않는다: 앱 화면이 붙이는 격리 머리글(sandbox CSP)이 그대로 가야 한다.
// 2. 기본 도메인의 첫 화면(/) · /posts · /m에 화면 머리글을 붙인다 (screen-headers.ts: next.config가 아니라 여기서 붙이는 까닭).
// 3. 콘솔(/admin) 요청에 지금 주소를 머리글로 붙인다 (웹 UX U2). 콘솔 틀(admin/layout)은 서버에서 그려 지금 주소를 모르는데,
//    로그인이 끝났으면 다시 로그인한 뒤 보던 주소로 돌아오게 로그인 화면에 넘겨야 한다.
//    막는 일은 하지 않는다 (로그인 확인은 서버 API가 한다). 밖에서 같은 머리글을 붙여 와도 여기서 덮어쓰고, 쓰는 쪽이 safeReturnPath로 다시 거른다.
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const host = hostOf(request.headers);
  const shared = appsOrigin();
  if (shared !== null && isAppsHost(host)) return appsAnswer(request);
  const app = await appOfHost(host);
  if (app !== null) {
    const prefix = `/${encodeURIComponent(app)}`;
    // 이미 앱 주소로 넘어온 요청이면 그대로: Next가 rewrite를 밖으로 다시 보내면(개발 서버를 127.0.0.1에 묶었을 때
    // nextUrl은 localhost로 바뀌어 출처가 달라진다) 같은 요청이 이 proxy를 한 번 더 지난다
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = `${prefix}${pathname === '/' ? '' : pathname}`;
    const res = NextResponse.rewrite(url);
    // 커뮤니티의 고정 화면(/_/…, 스토어 3-2)은 Cairn이 그리는 화면이라 화면 머리글을 붙인다:
    // 로그인 · 가입 폼을 다른 사이트가 겹쳐 놓고 누르게 하지 못하게 (앱 화면은 격리 머리글을 그대로 둔다)
    if (isMemberScreen(pathname)) for (const h of SCREEN_HEADERS) res.headers.set(h.key, h.value);
    return res;
  }
  // 기본 도메인 (앱 도메인이 아닌 호스트): 공통 앱 도메인이 있으면 첫 화면과 앱 주소는 그쪽으로 (예전 ?sheet= 주소는 여기서 콘솔로)
  if (shared !== null && movesToApps(pathname) && !request.nextUrl.searchParams.has('sheet'))
    return NextResponse.redirect(new URL(`${pathname}${search}`, shared), 308);
  if (isAppScreenRoot(pathname)) {
    const res = NextResponse.next();
    for (const h of SCREEN_HEADERS) res.headers.set(h.key, h.value);
    return res;
  }
  if (pathname !== '/admin' && !pathname.startsWith('/admin/')) return NextResponse.next();
  const headers = new Headers(request.headers);
  headers.set(RETURN_HEADER, `${pathname}${search}`);
  return NextResponse.next({ request: { headers } });
}

/** 공통 앱 도메인으로 온 화면 요청 */
function appsAnswer(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const kind = appsPathKind(pathname);
  if (kind === 'none') return new NextResponse('없는 주소예요', { status: 404 });
  if (kind === 'console') {
    // 콘솔 · 로그인 · 설치는 기본 도메인(CAIRN_WEB_URL)에서만 연다: 이 도메인에 관리자 쿠키를 두지 않는다
    const home = URL.canParse(process.env.CAIRN_WEB_URL ?? '') ? process.env.CAIRN_WEB_URL : null;
    if (home && !isAppsHost(new URL(home).hostname))
      return NextResponse.redirect(new URL(`${pathname}${request.nextUrl.search}`, home), 308);
    return new NextResponse('없는 주소예요', { status: 404 });
  }
  if (kind === 'home') {
    const url = request.nextUrl.clone();
    url.pathname = '/store';
    return NextResponse.rewrite(url);
  }
  const res = NextResponse.next();
  if (isAppsMemberScreen(pathname)) for (const h of SCREEN_HEADERS) res.headers.set(h.key, h.value);
  return res;
}

export const config = { matcher: ['/((?!_next/|api/|\\.well-known/).*)'] };
