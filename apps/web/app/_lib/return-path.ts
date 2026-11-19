// 로그인 뒤 돌아갈 곳 (?return=, 웹 보안 S1): 이 사이트 안의 경로만. 서버의 ReturnPath(account/owner/return-path.policy.ts)와 같은 규칙.
// 글자로 "/로 시작 · //가 아님"만 보면 `/\evil.com` · 탭이 낀 `/<탭>/evil.com`이 지나간다: 브라우저는 `\`를 `/`로 읽고
// 탭 · 줄바꿈을 지워 `//evil.com`(다른 사이트)으로 간다 (열린 리다이렉트). 그래서 브라우저와 같은 규칙(URL 해석)으로 읽어
// 출처가 그대로인지 보고, 해석한 모양을 돌려준다 (검사한 곳과 실제로 가는 곳이 같게)

/** 웹의 proxy(proxy.ts)가 콘솔 요청에 붙이는 지금 주소 (서버에서 그리는 콘솔 틀이 로그인으로 보낼 때 돌아올 곳, 웹 UX U2) */
export const RETURN_HEADER = 'x-cairn-path';

/** 로그인 화면 주소. 다시 로그인하면 back으로 돌아온다 (로그인 화면이 safeReturnPath로 다시 거른다) */
export function loginPath(back: string): string {
  return `/login?return=${encodeURIComponent(back)}`;
}

/** 출처를 비교할 가짜 출처 (어디에도 닿지 않는 이름) */
const BASE = 'http://return.invalid';

/** 이 사이트 안의 경로면 해석한 경로(경로 · 쿼리 · 조각), 아니면 fallback */
export function safeReturnPath(raw: string | null | undefined, fallback = '/admin'): string {
  if (!raw?.startsWith('/')) return fallback;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return fallback;
  }
  return url.origin === BASE ? `${url.pathname}${url.search}${url.hash}` : fallback;
}
