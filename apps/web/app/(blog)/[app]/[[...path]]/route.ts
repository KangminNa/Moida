import type { NextRequest } from 'next/server';
import type { SpaceInfo } from '../../../_account/types';
import { appDataAnswer } from '../../../_blog/app-data';
import { appOfHost } from '../../../_blog/app-domains';
import {
  appHeaders,
  openFilePolicy,
  renderAppScreen,
  renderStaticScreen,
} from '../../../_blog/app-screen';
import { opensApp } from '../../../_blog/apps-domain';
import { withConsoleLink } from '../../../_blog/console-link';
import { slugFrom } from '../../../_blog/format';
import { mapFor, mapHosts } from '../../../_blog/map-config';
import { mapSearchAnswer } from '../../../_blog/map-search';
import { moidaAnswer } from '../../../_blog/moida-client';
import { hostOf, originOf } from '../../../_blog/request-host';
import { brokenAnswer, missingAnswer, unreachableAnswer } from '../../../_blog/site-answer';
import type {
  AppScreen,
  AppScreenPage,
  AppScreenRedirect,
  AppScreenStatic,
} from '../../../_blog/types';
import { communityScreen } from '../../../_community/app-screen';
import { serverFetch, serverGet, serverRaw } from '../../../_lib/server-api';

// 앱 화면 (/<앱>/…, 스토어 1-6, docs/스토어.md 9.4). 앱마다 자기 코드(템플릿 · CSS · JS)로 그린다:
//   /<앱>/files/<이름>        앱 코드의 파일 (서버가 흘려보낸다)
//   /<앱>/~<토큰>/…           미리 보기 (그 토큰의 앱 · 버전, 비공개 앱도 공개된 것처럼)
//   그 밖 (/, posts/<글>, m/<메뉴>, m/<메뉴>/<번호>)  서버가 준 템플릿 · 데이터를 채워 격리 머리글과 함께
//   페이지 앱 (/, <이름>)       <이름>은 앱 코드의 <이름>.html. 앱 코드를 만든 적이 없고 공개 페이지가 있으면 그 페이지가 화면이다:
//                              첫 화면은 /index.html로 보내고(페이지 안의 상대 주소가 앱 주소 아래로 풀리게) 페이지의 파일을 그대로 넘긴다
//   정적 앱 (/<경로>)          moida.json에 "render": "static"인 페이지 앱 (스토어 9.13): 주소가 곧 묶음의 파일이다. HTML은 <base>와
//                              데이터 블록만 더해 격리 머리글과 함께, 그 밖의 파일은 서버가 흘려보낸 그대로. 없는 화면 주소는 첫 화면
//   커뮤니티 앱 (/, t/<글>)    + 회원 API로 읽은 글 · 댓글 · 회원 링크 (_community/app-screen.ts, 스토어 3-2).
//                              쓰기 화면은 템플릿이 아니라 고정 화면 /_/… (%5F/ 폴더, 앱 도메인에서만)
// 없는 앱 · 비공개 앱 · 틀린 토큰과 웹의 다른 없는 주소는 모두 같은 Moida 404 (앱이 있다는 사실이 드러나지 않게).
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
  // 미리 보기 주소 아래의 moida.js (/<앱>/~<토큰>/_/moida.js): 닫힌 스크립트 (미리 보기는 격리한다, 스토어 12.2)
  if (
    ticket !== null &&
    parts.length === 2 &&
    parts[0] === '_' &&
    (parts[1] === 'moida.js' || parts[1] === 'cairn.js')
  )
    return moidaAnswer(false, await mapFor(false));
  // 미리 보기 주소 아래의 화면 데이터 (/<앱>/~<토큰>/_/data, moida.data): 그 토큰의 버전 그대로
  if (ticket !== null && parts.length === 2 && parts[0] === '_' && parts[1] === 'data')
    return appDataAnswer(request, app, ticket);
  // 미리 보기 주소 아래의 장소 · 주소 찾기 (/<앱>/~<토큰>/_/map/<동작>, moida.map.search): 토큰과 상관없이 같은 찾기
  if (ticket !== null && parts.length === 3 && parts[0] === '_' && parts[1] === 'map')
    return mapSearchAnswer(request, parts[2] ?? '');
  if (parts[0] === 'files' && parts.length === 2) {
    // 없으면 화면으로 넘긴다: 정적 앱의 files/ 폴더일 수 있다 (그 밖에는 화면이 404를 낸다)
    const found = await file(request, app, parts[1] ?? '', ticket);
    if (found) return found;
  }
  return screen(request, app, parts, ticket);
}

/**
 * 앱 코드의 파일 하나 (name은 폴더가 든 이름일 수 있다). 없는 파일이면 null.
 * 그 앱의 도메인으로 온 요청(미리 보기 아님)이면 격리 머리글을 뺀다 (스토어 12.2: 서비스 워커 · 워커가 그 출처로 돌게)
 */
async function file(
  request: NextRequest,
  app: string,
  name: string,
  ticket: string | null,
): Promise<Response | null> {
  const query = ticket ? `?ticket=${encodeURIComponent(ticket)}` : '';
  const path = name.split('/').map(encodeURIComponent).join('/');
  const res = await serverRaw(`/api/apps/site/${encodeURIComponent(app)}/files/${path}${query}`);
  if (!res) return unreachableAnswer();
  if (!res.ok) return null;
  const own = ticket === null && (await opensApp(hostOf(request.headers), app));
  return passOn(
    res,
    own ? openFilePolicy(originOf(request.headers, request.nextUrl.protocol)) : null,
  );
}

/**
 * 서버가 붙인 형식 · 캐시 · 격리 머리글을 그대로 넘긴다 (앱 코드의 파일 · 페이지의 파일).
 * policy를 주면 격리 머리글 대신 그 CSP를 붙인다 (격리를 푼 앱 도메인의 파일)
 */
function passOn(res: Response, policy: string | null = null): Response {
  const headers = new Headers();
  for (const key of [
    'content-type',
    'content-length',
    'cache-control',
    'etag',
    'content-security-policy',
    'x-content-type-options',
    'referrer-policy',
    // 격리된 앱 화면(출처 없는 문서)이 모듈 스크립트 · 글꼴 · fetch로 자기 파일을 읽는다
    'access-control-allow-origin',
  ]) {
    const value = res.headers.get(key);
    if (value) headers.set(key, value);
  }
  if (policy !== null) {
    headers.set('content-security-policy', policy);
    // 서비스 워커가 앱 주소 전체를 맡을 수 있게 (assets/sw.js처럼 폴더 안에 두어도)
    headers.set('service-worker-allowed', '/');
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
  const reply = await serverFetch<AppScreen | AppScreenRedirect | AppScreenPage | AppScreenStatic>(
    `/api/apps/site/${encodeURIComponent(app)}/screen?${query}`,
  );
  if (reply.status === 0) return unreachableAnswer();
  if (reply.status !== 200 || !reply.data) return missingAnswer();
  const answer = reply.data;
  if (answer.redirect !== null)
    return Response.redirect(new URL(answer.redirect, request.url), answer.permanent ? 308 : 307);
  if (answer.page !== null) return pageScreen(request, answer.page);
  if ('static' in answer) return staticScreen(request, app, answer, ticket, host);
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
    html = renderAppScreen(shown, template, space?.name || 'Moida', ticket, extra);
  } catch (error) {
    // 템플릿 문법 오류: 미리 보기에서만 까닭을 보인다 (공개 버전은 미리 본 뒤에 공개한다)
    return brokenAnswer(ticket && error instanceof Error ? error.message : null);
  }
  const site = await siteOf(request, app, host, space);
  const headers = appHeaders(
    site.origin,
    [...shown.hosts, ...mapHosts(await mapFor(shown.open))],
    ticket !== null,
    null,
    shown.open ? shown.permissions : null,
  );
  return htmlAnswer(request, html, status, headers, shown.console);
}

/**
 * 격리 머리글의 사이트 주소: 앱 파일 · 사진을 받는 출처. 앱 도메인이면 그 도메인, 아니면 정해 둔 사이트 주소(없으면 요청이 온 주소).
 * own은 그 출처에서 이 앱의 주소 앞부분 (끝에 /)
 */
async function siteOf(
  request: NextRequest,
  app: string,
  host: string | null,
  space: SpaceInfo | null,
): Promise<{ origin: string; own: string }> {
  if (await opensApp(host, app)) {
    const origin = originOf(request.headers, request.nextUrl.protocol);
    // 공통 앱 도메인이면 앱은 그 도메인의 /<앱>/ 아래 (2026-11-27)
    const shared = (await appOfHost(host)) !== app;
    return { origin, own: shared ? `${origin}/${encodeURIComponent(app)}/` : `${origin}/` };
  }
  const origin = new URL(space?.siteUrl || request.nextUrl.origin).origin;
  return { origin, own: `${origin}/${encodeURIComponent(app)}/` };
}

/** 정적 앱 (스토어 9.13): HTML이면 <base> · 데이터 블록을 더해 격리 머리글과 함께, 그 밖의 파일은 서버가 준 그대로 */
async function staticScreen(
  request: NextRequest,
  app: string,
  shown: AppScreenStatic,
  ticket: string | null,
  host: string | null,
): Promise<Response> {
  const { file: name, text } = shown.static;
  if (name === null) return missingAnswer();
  if (text === null || shown.data === null)
    return (await file(request, app, name, ticket)) ?? missingAnswer();
  const space = await serverGet<SpaceInfo>('/api/space', true);
  const html = renderStaticScreen(text, name, shown.data, space?.name || 'Moida', ticket);
  const site = await siteOf(request, app, host, space);
  const headers = appHeaders(
    site.origin,
    [...shown.hosts, ...mapHosts(await mapFor(shown.open))],
    ticket !== null,
    site.own,
    shown.open ? shown.permissions : null,
  );
  return htmlAnswer(request, html, 200, headers, shown.console);
}

/**
 * 그린 앱 화면 HTML. 관리자가 연 화면이면 "콘솔로" 링크를 붙이고, 사람마다 다른 답이라 공용 캐시에 두지 않는다
 * (콘솔의 미리 보기 틀 안에서는 붙이지 않는다: Sec-Fetch-Dest가 iframe)
 */
function htmlAnswer(
  request: NextRequest,
  html: string,
  status: number,
  headers: Headers,
  consolePath: string | null,
): Response {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  if (consolePath === null) return new Response(html, { status, headers });
  headers.set('Cache-Control', 'private, no-store');
  const framed = request.headers.get('sec-fetch-dest') === 'iframe';
  return new Response(withConsoleLink(html, consolePath, framed), { status, headers });
}
