import { type ApiReply, api } from '../_lib/client-api';

// 커뮤니티 회원 API 부르기 (브라우저, 앱 도메인의 고정 화면). 회원 쿠키를 실은 쓰기는 그 쿠키의 확인 값을
// X-Cairn-CSRF로 함께 보내야 한다 (서버 MemberGuard). 값은 화면을 그릴 때 서버에서 읽은 GET /api/community/me의 csrf다:
// 로그인 · 가입으로 쿠키가 바뀌면 화면을 새로 열어(location.replace) 새 값을 받는다

// 공통 앱 도메인(2026-11-27)에서는 고정 화면이 /<앱>/_/… 아래에 있다: 그 첫 칸을 x-cairn-app으로 서버에 알린다
// (자기 도메인의 /_/…면 머리글 없음, 서버가 도메인으로 안다)
const SHARED = /^\/([^/]+)\/_(?:\/|$)/;

/** 이 화면의 앱 (공통 앱 도메인일 때만) */
function appHeader(): Record<string, string> {
  const app = typeof location === 'undefined' ? null : SHARED.exec(location.pathname)?.[1];
  return app ? { 'x-cairn-app': decodeURIComponent(app) } : {};
}

/** csrf: 이 브라우저 쿠키의 확인 값 (쿠키가 없으면 null: 가입 · 로그인) */
export function memberApi<T>(
  csrf: string | null,
  method: string,
  path: string,
  body?: object,
): Promise<ApiReply<T>> {
  return api<T>(method, `/api/community/${path}`, body, {
    ...appHeader(),
    ...(csrf ? { 'x-cairn-csrf': csrf } : {}),
  });
}
