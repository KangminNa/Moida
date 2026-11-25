// 콘솔 주소 (2026-11-25): 콘솔은 어느 도메인에서나 /admin이다. 앱 도메인에서 연 /admin은 사이트 주소의 같은 경로로 보낸다 (proxy.ts)

/** 콘솔 주소인가 (/admin, /admin/…). /administrator 같은 앱의 주소는 아니다 */
export function isConsolePath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

/** 사이트 출처의 콘솔 주소. 출처는 서버가 정한 사이트 주소라 경로 · 쿼리만 붙인다. 사이트 주소를 정하기 전이면 null */
export function consoleUrlOn(site: string | null, pathname: string, search: string): string | null {
  return site === null || !isConsolePath(pathname) ? null : `${site}${pathname}${search}`;
}
