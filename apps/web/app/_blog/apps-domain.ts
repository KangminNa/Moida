import { appOfHost } from './app-domains';

// 공통 앱 도메인 (2026-11-27, 기획서 결정 "apps.moida.ai.kr"): 배포가 정한 CAIRN_APPS_URL. 콘솔(기본 도메인)과 다른 출처라
// 그 도메인으로 연 앱 화면은 격리를 풀고, 앱은 경로의 첫 칸(/<앱>/…)에 있다. 서버에는 x-cairn-app 머리글로 앱을 알린다
// (서버의 HostGate가 같은 값으로 고른다). 자기 도메인을 연결한 앱은 지금처럼 그 도메인이 먼저다.
// 웹 서버 쪽에서만 읽는다 (브라우저 묶음에 넣지 않는다): 브라우저는 주소의 첫 칸으로 안다 (member-api.ts · cairn.js)

/** 공통 앱 도메인의 출처 (https://apps.example.com). 정하지 않았거나 틀린 주소면 null */
export function appsOrigin(): string | null {
  const raw = process.env.CAIRN_APPS_URL ?? '';
  return URL.canParse(raw) ? new URL(raw).origin : null;
}

/** 이 호스트가 공통 앱 도메인인가 (hostOf로 다듬은 값) */
export function isAppsHost(host: string | null): boolean {
  const origin = appsOrigin();
  return host !== null && origin !== null && new URL(origin).hostname === host;
}

/** 이 요청이 이 앱을 격리 없이 여는 곳인가: 그 앱의 확인한 도메인이거나 공통 앱 도메인 */
export async function opensApp(host: string | null, slug: string): Promise<boolean> {
  return isAppsHost(host) || (await appOfHost(host)) === slug;
}

/** 서버에 넘길 앱 (x-cairn-app): 공통 앱 도메인이면 그 앱의 주소, 자기 도메인이면 null (서버가 도메인으로 안다) */
export function appHeaderOf(host: string | null, slug: string): string | null {
  return isAppsHost(host) ? slug : null;
}
