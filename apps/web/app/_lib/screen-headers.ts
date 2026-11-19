// 웹이 그리는 화면의 보안 머리글 (next.config.ts와 proxy.ts가 함께 쓴다).
//   frame-ancestors · X-Frame-Options: 다른 사이트가 우리 화면을 겹쳐 놓고 누르게 하지 못하게
//   form-action: 폼은 이 사이트로만 (화면의 폼은 모두 fetch로 보낸다)
//   Referrer-Policy: 다른 사이트로 갈 때 도메인만 넘기고 경로·파라미터는 넘기지 않게
//   Strict-Transport-Security: https로 한 번 온 브라우저는 늘 https로 (http에서는 브라우저가 무시)
// 스크립트 출처까지 막는 전체 CSP는 블로그 화면(M4)에서 플러그인의 외부 스크립트와 함께 정한다.
export const SCREEN_HEADERS: readonly { key: string; value: string }[] = [
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
];

/**
 * 앱 도메인(스토어 3-0)에서는 앱 화면이 되는 웹의 경로: 첫 화면(/) · /posts/… · /m/….
 * next.config의 머리글은 들어온 경로로 붙고 앱 화면의 격리 머리글(sandbox CSP)을 덮어쓰므로,
 * 이 경로의 화면 머리글은 next.config가 아니라 proxy.ts가 기본 도메인에서만 붙인다
 */
export const APP_SCREEN_ROOTS: readonly string[] = ['posts', 'm'];

export function isAppScreenRoot(pathname: string): boolean {
  if (pathname === '/') return true;
  const first = pathname.split('/')[1] ?? '';
  return APP_SCREEN_ROOTS.includes(first);
}
