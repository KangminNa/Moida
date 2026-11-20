import type { NextRequest } from 'next/server';
import type { SpaceInfo } from '../../../_account/types';
import { appOfHost } from '../../../_blog/app-domains';
import { appHeaders, renderAppScreen } from '../../../_blog/app-screen';
import { slugFrom } from '../../../_blog/format';
import { hostOf, originOf } from '../../../_blog/request-host';
import { brokenAnswer, missingAnswer, unreachableAnswer } from '../../../_blog/site-answer';
import type { AppScreen, AppScreenPage, AppScreenRedirect } from '../../../_blog/types';
import { communityScreen } from '../../../_community/app-screen';
import { serverFetch, serverGet, serverRaw } from '../../../_lib/server-api';

// 앱 화면 (/<앱>/…, 스토어 1-6, docs/스토어.md 9.4). 앱마다 자기 코드(템플릿 · CSS · JS)로 그린다:
//   /<앱>/files/<이름>        앱 코드의 파일 (서버가 흘려보낸다)
//   /<앱>/~<토큰>/…           미리 보기 (그 토큰의 앱 · 버전, 비공개 앱도 공개된 것처럼)
//   그 밖 (/, posts/<글>, m/<메뉴>, m/<메뉴>/<번호>)  서버가 준 템플릿 · 데이터를 채워 격리 머리글과 함께
//   페이지 앱 (/, <이름>)       <이름>은 앱 코드의 <이름>.html. 앱 코드를 만든 적이 없고 공개 페이지가 있으면 그 페이지가 화면이다:
//                              첫 화면은 /index.html로 보내고(페이지 안의 상대 주소가 앱 주소 아래로 풀리게) 페이지의 파일을 그대로 넘긴다
//   커뮤니티 앱 (/, t/<글>)    + 회원 API로 읽은 글 · 댓글 · 회원 링크 (_community/app-screen.ts, 스토어 3-2).
//                              쓰기 화면은 템플릿이 아니라 고정 화면 /_/… (%5F/ 폴더, 앱 도메인에서만)
// 없는 앱 · 비공개 앱 · 틀린 토큰과 웹의 다른 없는 주소는 모두 같은 Cairn 404 (앱이 있다는 사실이 드러나지 않게).
// 앱 RSS(/<앱>/rss.xml · /<앱>/m/<메뉴>/rss.xml)는 따로 있는 경로라 여기에 오지 않는다.
// 앱 도메인 (스토어 3-0): proxy.ts가 앱 도메인의 요청을 이 경로로 넘긴다. 방문자가 연 호스트를 서버에 넘기면 서버가 주소 기준을 정한다
// (그 앱의 도메인이면 도메인의 뿌리가 앱 주소, 기본 도메인인데 연결을 확인한 도메인이 있으면 그리로 308).
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ app: string; path?: string[] }> };

const TICKET = '~';

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  const { app: rawApp, path: rawPath = [] } = await params;
  const app = slugFrom(rawApp);
  const parts = rawPath.map(slugFrom);
  const ticket = parts[0]?.startsWith(TICKET) ? (parts.shift() ?? '').slice(1) : null;
  if (parts[0] === 'files' && parts.length === 2) return file(app, parts[1] ?? '', ticket);
  return screen(request, app, parts, ticket);
}

async function file(app: string, name: string, ticket: string | null): Promise<Response> {
  const query = ticket ? `?ticket=${encodeURIComponent(ticket)}` : '';
  const res = await serverRaw(
    `/api/apps/site/${encodeURIComponent(app)}/files/${encodeURIComponent(name)}${query}`,
  );
  if (!res) return unreachableAnswer();
  if (!res.ok) return missingAnswer();
  return passOn(res);
}

/** 서버가 붙인 형식 · 캐시 · 격리 머리글을 그대로 넘긴다 (앱 코드의 파일 · 페이지의 파일) */
function passOn(res: Response): Response {
  const headers = new Headers();
  for (const key of [
    'content-type',
    'content-length',
    'cache-control',
    'etag',
    'content-security-policy',
    'x-content-type-options',
    'referrer-policy',
  ]) {
    const value = res.headers.get(key);
    if (value) headers.set(key, value);
  }
  return new Response(res.body, { status: 200, headers });
}

/** 화면이 페이지인 페이지 앱 (페이지 앱 P1 ④): 첫 화면은 <앱>/index.html로, 파일은 페이지의 바깥 주소에서 받아 넘긴다 */
async function pageScreen(
  request: NextRequest,
  { name, file, base }: NonNullable<AppScreenPage['page']>,
): Promise<Response> {
  if (file === null) return Response.redirect(new URL(`${base}/index.html`, request.url), 307);
  const res = await serverRaw(
    `/api/pages/site/${encodeURIComponent(name)}/${encodeURIComponent(file)}`,
  );
  if (!res) return unreachableAnswer();
  if (!res.ok) return missingAnswer();
  return passOn(res);
}

async function screen(
  request: NextRequest,
  app: string,
  parts: readonly string[],
  ticket: string | null,
): Promise<Response> {
  const query = new URLSearchParams({ path: parts.join('/') });
  const cursor = request.nextUrl.searchParams.get('cursor');
  if (cursor) query.set('cursor', cursor);
  if (ticket) query.set('ticket', ticket);
  const host = hostOf(request.headers);
  if (host) query.set('host', host);
  // 쿠키를 넘긴다: 관리자가 비공개 앱을 열면 서버가 미리 보기 토큰 주소로 보낸다 (데이터는 누구든 방문자 데이터다)
  const reply = await serverFetch<AppScreen | AppScreenRedirect | AppScreenPage>(
    `/api/apps/site/${encodeURIComponent(app)}/screen?${query}`,
  );
  if (reply.status === 0) return unreachableAnswer();
  if (reply.status !== 200 || !reply.data) return missingAnswer();
  const answer = reply.data;
  if (answer.redirect !== null)
    return Response.redirect(new URL(answer.redirect, request.url), answer.permanent ? 308 : 307);
  if (answer.page !== null) return pageScreen(request, answer.page);
  const shown = answer;
  if (shown.template === null) return missingAnswer();
  // 커뮤니티 (스토어 3-2): 글 · 댓글 · 회원 링크는 회원 API로 읽어 더한다. 글이 없으면 그 앱의 404.html
  let [template, status] = [shown.template, shown.status];
  let extra: Record<string, unknown> = {};
  if (shown.data.app.kind === 'community') {
    const filled = await communityScreen(shown.data, app, host, parts, cursor);
    extra = filled.extra;
    if (filled.missing) [template, status] = ['404.html', 404];
    if (!shown.templates[template]) return missingAnswer();
  }
  const space = await serverGet<SpaceInfo>('/api/space', true);
  let html: string;
  try {
    html = renderAppScreen(shown, template, space?.name || 'Cairn', ticket, extra);
  } catch (error) {
    // 템플릿 문법 오류: 미리 보기에서만 까닭을 보인다 (공개 버전은 미리 본 뒤에 공개한다)
    return brokenAnswer(ticket && error instanceof Error ? error.message : null);
  }
  // 격리 머리글의 사이트 주소: 앱 파일 · 사진을 받는 출처. 앱 도메인이면 그 도메인, 아니면 정해 둔 사이트 주소(없으면 요청이 온 주소)
  const own = (await appOfHost(host)) === app;
  const site = own
    ? originOf(request.headers, request.nextUrl.protocol)
    : new URL(space?.siteUrl || request.nextUrl.origin).origin;
  const headers = appHeaders(site, shown.hosts, ticket !== null);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(html, { status, headers });
}
