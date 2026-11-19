import { type ApiReply, api } from '../_lib/client-api';

// 커뮤니티 회원 API 부르기 (브라우저, 앱 도메인의 고정 화면). 회원 쿠키를 실은 쓰기는 그 쿠키의 확인 값을
// X-Cairn-CSRF로 함께 보내야 한다 (서버 MemberGuard). 값은 화면을 그릴 때 서버에서 읽은 GET /api/community/me의 csrf다:
// 로그인 · 가입으로 쿠키가 바뀌면 화면을 새로 열어(location.replace) 새 값을 받는다

/** csrf: 이 브라우저 쿠키의 확인 값 (쿠키가 없으면 null: 가입 · 로그인) */
export function memberApi<T>(
  csrf: string | null,
  method: string,
  path: string,
  body?: object,
): Promise<ApiReply<T>> {
  return api<T>(method, `/api/community/${path}`, body, csrf ? { 'x-cairn-csrf': csrf } : {});
}
