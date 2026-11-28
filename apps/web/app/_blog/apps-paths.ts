import { SERVER_ISOLATED_ROUTES, WEB_ROUTES } from '../_lib/screen-headers.ts';

// 공통 앱 도메인(MOIDA_APPS_URL, 2026-11-27)의 경로 나누기 (proxy.ts가 쓴다). 앱 주소(slug)는 웹의 최상위 경로와 겹치지 않는다
// (서버 App.RESERVED, 구조 검사). 그래서 첫 칸만 보면 앱인지 웹의 화면인지 안다.
//   공통 앱 도메인: / 는 스토어 첫 화면, /join은 스토어 가입, /_/login · /_/reset · /_/me는 앱 없는 계정 화면, 그 밖의 웹 화면(콘솔 · 로그인 · 설치 …)은 기본 도메인으로 넘기고, 나머지는 앱 (/<앱>/…)
//   기본 도메인: 공통 앱 도메인이 정해져 있으면 / 와 앱 주소를 그쪽으로 넘긴다. 콘솔의 미리 보기(/<앱>/~<표>/…)와 웹 화면은 그대로

/** 공통 앱 도메인에서도 여는 웹의 화면 */
const APPS_WEB = new Set(['join', 'store']);

/** 웹이 내는 파일처럼 점이 든 첫 칸 (rss.xml · sw.js · manifest …): 앱 주소에는 점이 없다 */
function isFile(first: string): boolean {
  return first.includes('.');
}

function firstOf(pathname: string): string {
  return pathname.split('/')[1] ?? '';
}

function isWebRoute(first: string): boolean {
  return WEB_ROUTES.includes(first) || SERVER_ISOLATED_ROUTES.includes(first);
}

/** 공통 앱 도메인으로 온 경로가 무엇인가: 첫 화면 · 그대로 여는 웹 화면 · 기본 도메인의 화면(콘솔 · 로그인 …) · 없는 주소 · 앱 */
export function appsPathKind(pathname: string): 'home' | 'web' | 'console' | 'none' | 'app' {
  const first = firstOf(pathname);
  if (first === '') return 'home';
  if (APPS_WEB.has(first) || isFile(first)) return 'web';
  if (isWebRoute(first)) return 'console';
  if (first === '_') return 'web'; // 앱 없는 로그인 /_/login (2026-11-27)
  if (first.startsWith('~')) return 'none';
  return 'app';
}

/** 기본 도메인에서 공통 앱 도메인으로 넘길 경로인가: 첫 화면과 앱 주소 (미리 보기 · 웹 화면 · 파일은 그대로) */
export function movesToApps(pathname: string): boolean {
  const first = firstOf(pathname);
  if (first === '') return true;
  if (isWebRoute(first) || isFile(first) || first === '_') return false;
  return !(pathname.split('/')[2] ?? '').startsWith('~');
}

/** 공통 앱 도메인의 고정 화면 (/<앱>/_/… · 앱 없는 /_/login): Moida가 그리는 화면이라 화면 머리글을 붙인다 */
export function isAppsMemberScreen(pathname: string): boolean {
  const parts = pathname.split('/');
  return parts[1] === '_' || parts[2] === '_';
}
