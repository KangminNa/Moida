import { safeReturnPath } from '../_lib/return-path.ts';

// 회원 화면(가입 · 로그인)이 끝난 뒤 돌아갈 곳 (스토어 3-2). 고정 화면은 앱 도메인에만 있어 그 도메인 안의 경로면 앱 안이다.
// 다른 사이트로 가는 주소는 safeReturnPath가 막고(웹 보안 S1), 가입 · 로그인 화면으로 돌아가면 다시 그 화면이라 첫 화면으로 둔다

const LOOP = /^\/_\/(login|join)(?:[/?#]|$)/;

export function memberReturn(raw: string | null | undefined): string {
  const path = safeReturnPath(raw, '/');
  return LOOP.test(path) ? '/' : path;
}
