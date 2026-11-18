// 블로그 화면의 날짜. 시간대는 우선 한국 시간으로 둔다 (블로그 설정이 생기면 그리로 옮긴다).
const DATE = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Seoul',
});

export function formatDate(iso: string | null): string {
  return iso ? DATE.format(new Date(iso)) : '';
}

/** 주소의 글 이름(slug). 한글 주소는 인코딩된 채로 올 수 있다 */
export function slugFrom(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** 앱의 바깥 주소 (스토어 1단계) */
export function appPath(app: string): string {
  return `/${encodeURIComponent(app)}`;
}

/**
 * 글의 바깥 주소. app: 든 앱의 주소 (/<앱>/posts/<글>).
 * null이면 고정 주소 /posts/<글>: 지금 든 앱으로 넘겨 준다 (그래프 · 편집기 · 옛 링크처럼 앱을 모르는 곳)
 */
export function postPath(slug: string, app: string | null): string {
  const path = `/posts/${encodeURIComponent(slug)}`;
  return app === null ? path : `${appPath(app)}${path}`;
}

/** 페이지의 바깥 주소. 서버가 문(index.html)으로 보낸다 */
export function pagePath(name: string): string {
  return `/pages/${encodeURIComponent(name)}`;
}

/** 메뉴의 바깥 주소 (2차 6단계). app: 든 앱. null이면 옛 주소 /m/<메뉴>: 그 주소의 메뉴가 있는 첫 공개 앱으로 넘겨 준다 */
export function menuPath(slug: string, app: string | null): string {
  const path = `/m/${encodeURIComponent(slug)}`;
  return app === null ? path : `${appPath(app)}${path}`;
}
