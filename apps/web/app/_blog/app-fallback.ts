// 정적 앱의 검색용 기본 HTML (2026-11-25, docs/스토어.md 14장 A3). 정적 앱은 앱 JS가 글 · 목록을 그려서
// 스크립트를 돌리지 않는 검색 로봇 · 읽기 도구에는 빈 화면이다. 그 주소의 데이터로 <noscript> 안에 제목 · 본문 · 글 링크를 싣는다.
// 앱 JS가 도는 브라우저에는 보이지 않는다. 글 본문은 웹이 거른 HTML(renderMarkdown)이고, 그 밖의 글자는 모두 바꿔 싣는다

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

const text = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c);

/** 같은 출처의 주소만 링크로 (/로 시작하는 앱 안 주소 · http(s)) */
const href = (value: unknown): string | null => {
  const url = String(value ?? '');
  return /^(\/(?!\/)|https?:\/\/)/.test(url) ? text(url) : null;
};

type Item = { title?: unknown; url?: unknown; excerpt?: unknown };

function list(items: unknown): string {
  if (!Array.isArray(items) || items.length === 0) return '';
  const rows = (items as Item[]).map((p) => {
    const to = href(p.url);
    const title = text(p.title);
    const excerpt = p.excerpt ? `<p>${text(p.excerpt)}</p>` : '';
    return `<li>${to ? `<a href="${to}">${title}</a>` : title}${excerpt}</li>`;
  });
  return `<ul>${rows.join('')}</ul>`;
}

/** 데이터(웹이 html · dateText를 더한 것)로 만든 <noscript>. 실을 것이 없으면 빈 글 */
export function fallbackOf(data: Readonly<Record<string, unknown>>): string {
  const app = (data.app ?? {}) as { name?: unknown; description?: unknown };
  const post = data.post as { title?: unknown; html?: unknown } | null | undefined;
  const issue = data.issue as { title?: unknown; intro?: unknown } | null | undefined;
  const menu = data.menu as { name?: unknown } | null | undefined;
  const parts: string[] = [];
  if (post) parts.push(`<article><h1>${text(post.title)}</h1>${String(post.html ?? '')}</article>`);
  else {
    const title = issue?.title ?? menu?.name ?? app.name;
    if (title) parts.push(`<h1>${text(title)}</h1>`);
    const intro = issue?.intro ?? (menu ? null : app.description);
    if (intro) parts.push(`<p>${text(intro)}</p>`);
    parts.push(list(data.posts), list(data.issues));
  }
  const body = parts.join('');
  return body ? `<noscript><main>${body}</main></noscript>` : '';
}
