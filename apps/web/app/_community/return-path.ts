import { safeReturnPath } from '../_lib/return-path.ts';

// 회원 화면(가입 · 로그인)이 끝난 뒤 돌아갈 곳 (스토어 3-2). 고정 화면은 앱 도메인에만 있어 그 도메인 안의 경로면 앱 안이다.
// 다른 사이트로 가는 주소는 safeReturnPath가 막고(웹 보안 S1), 가입 · 로그인 화면으로 돌아가면 다시 그 화면이라 첫 화면으로 둔다.
// base: 앱 화면의 뿌리 (자기 도메인은 '', 공통 앱 도메인은 /<앱>, 2026-11-27). 첫 화면은 `${base}/`

const LOOP = /^\/_\/(login|join)(?:[/?#]|$)/;

export function memberReturn(raw: string | null | undefined, base = ''): string {
  const home = `${base}/`;
  const path = safeReturnPath(raw, home);
  const inner = base && path.startsWith(`${base}/`) ? path.slice(base.length) : path;
  return LOOP.test(inner) ? home : path;
}
