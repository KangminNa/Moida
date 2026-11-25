/**
 * 관리자가 연 앱 화면의 "콘솔로" 링크 (2026-11-25 사용자 요청): 서버가 관리자에게만 준 콘솔 주소를 </body> 앞에 작게 붙인다.
 * 앱의 CSS가 덮지 못하게 모양은 style 속성에만 둔다 (화면 CSP가 style-src 'unsafe-inline'을 연다).
 * 콘솔의 미리 보기 틀(iframe) 안에서는 붙이지 않는다: 이미 콘솔이고, 콘솔은 틀 안에서 열리지 않는다
 */
export function withConsoleLink(html: string, path: string | null, framed: boolean): string {
  if (path === null || framed || !path.startsWith('/admin/')) return html;
  const href = encodeURI(path).replace(/"/g, '%22');
  const link = `<a href="${href}" title="관리자에게만 보여요" style="${CONSOLE_LINK_STYLE}">콘솔로</a>`;
  const end = html.search(/<\/body>/i);
  return end >= 0 ? `${html.slice(0, end)}${link}${html.slice(end)}` : `${html}${link}`;
}

const CONSOLE_LINK_STYLE = [
  'position:fixed',
  'left:12px',
  'bottom:12px',
  'z-index:2147483647',
  'padding:6px 12px',
  'border-radius:999px',
  'background:rgba(20,20,20,.78)',
  'color:#fff',
  'font:500 13px/1.4 system-ui,sans-serif',
  'text-decoration:none',
  'box-shadow:0 2px 8px rgba(0,0,0,.25)',
].join(';');
