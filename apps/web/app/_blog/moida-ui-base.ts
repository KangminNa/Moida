// moida.js의 화면 부품 (2026-11-28, 사용자 "플러그인이나 기능들이 라이브러리 형태로 바로 사용"): 앱 코드가 태그 한 줄로 쓰는 부품.
// 부품은 그림자 DOM 없이(light DOM) 그려 앱의 CSS가 그대로 먹고, 이름은 모두 moida- 로 시작한다. 색 · 간격은 앱의 토큰
// (moida-make 스킬 design.md의 --bg · --fg · --accent · --space-* …)을 쓰고, 없으면 무난한 값으로.
// 이 파일은 부품들이 함께 쓰는 것(한 번만 싣는 CSS · 요소 만들기 · 목록 읽기)이다. 부품 파일(moida-ui-*.ts)과 한 함수 안에서 이어 붙는다.
// 브라우저에서 그대로 도는 글자다: 빌드를 거치지 않는다

export const UI_BASE = String.raw`
  const M = window.moida;
  const CSS = [
    'moida-place-list,moida-map,moida-account,moida-rows{display:block}',
    '.moida-tools{display:flex;flex-wrap:wrap;gap:var(--space-2,8px);align-items:center;margin:0 0 var(--space-3,12px)}',
    '.moida-chips{display:flex;gap:var(--space-2,8px);max-width:100%;overflow-x:auto}',
    '.moida-chips:empty{display:none}',
    '.moida-chip,.moida-button{min-height:var(--tap,44px);padding:0 var(--space-4,16px);border:0;border-radius:var(--radius-full,999px);background:var(--surface,#f2f2f4);color:var(--fg,#17181c);font:inherit;white-space:nowrap;cursor:pointer}',
    '.moida-chip[aria-pressed="true"],.moida-button.is-main{background:var(--accent,#2563eb);color:var(--accent-fg,#fff)}',
    '.moida-find{flex:1;min-width:12rem;min-height:var(--tap,44px);padding:0 var(--space-3,12px);border:1px solid var(--line,#e3e5e9);border-radius:var(--radius,8px);background:var(--bg,#fff);color:var(--fg,#17181c);font:inherit;font-size:1rem}',
    '.moida-split{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-3,12px)}',
    '.moida-map{height:var(--moida-map-height,42vh);min-height:240px;border-radius:var(--radius,8px);background:var(--surface,#f2f2f4)}',
    '.moida-note,.moida-count,.moida-empty{margin:var(--space-2,8px) 0;color:var(--muted,#5b5f69);font-size:var(--text-sm,.875rem)}',
    '.moida-note:empty{display:none}',
    '.moida-places{margin:0;padding:0;list-style:none}',
    '.moida-place{padding:var(--space-2,8px) var(--space-3,12px) var(--space-3,12px);border-bottom:1px solid var(--line,#e3e5e9);border-radius:var(--radius,8px)}',
    '.moida-place.is-on{background:var(--surface,#f2f2f4)}',
    '.moida-place-name{display:block;width:100%;min-height:var(--tap,44px);padding:0;border:0;background:none;color:inherit;font:inherit;font-size:var(--text-lg,1.125rem);font-weight:600;text-align:left;cursor:pointer}',
    '.moida-place.is-on .moida-place-name{color:var(--accent,#2563eb)}',
    '.moida-meta{margin:0;color:var(--muted,#5b5f69);font-size:var(--text-sm,.875rem)}',
    '.moida-links{display:flex;gap:var(--space-3,12px);margin:var(--space-1,4px) 0 0;font-size:var(--text-sm,.875rem)}',
    '.moida-links a{color:var(--accent,#2563eb)}',
    '.moida-account{display:flex;flex-wrap:wrap;gap:var(--space-2,8px);align-items:center}',
    '.moida-who{color:var(--fg,#17181c);font-weight:600}',
    'moida-place-list :focus-visible,moida-account :focus-visible{outline:2px solid var(--accent,#2563eb);outline-offset:2px}',
    'moida-place-list.no-map .moida-map{display:none}',
    '@media (min-width:900px){moida-place-list:not(.no-map) .moida-split{grid-template-columns:minmax(0,1fr) minmax(280px,400px);align-items:start}moida-place-list .moida-mapbox{position:sticky;top:0}moida-place-list .moida-map{height:var(--moida-map-height,calc(100dvh - 32px))}}',
  ].join('\n');
  const smooth = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
  function addStyle() {
    if (document.getElementById('moida-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'moida-ui-style';
    style.textContent = CSS;
    // 앱의 CSS가 뒤에 와서 덮을 수 있게 head의 맨 앞에 둔다
    document.head.prepend(style);
  }
  /** 요소 하나. text는 늘 textContent로 넣는다 (방문자 · 회원이 쓴 글을 HTML로 넣지 않는다) */
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  /** 부품이 알리는 일 (moida:ready · moida:select). 앱 코드는 addEventListener로 받는다 */
  function emit(node, name, detail) {
    node.dispatchEvent(new CustomEvent('moida:' + name, { detail, bubbles: true }));
  }
  /** 목록 읽기: table이면 앱 데이터 표(100줄까지), src면 같은 묶음의 JSON 파일(배열) */
  async function listOf(node) {
    const table = node.getAttribute('table');
    if (table) return (await M.from(table).select().limit(100)).rows;
    const src = node.getAttribute('src');
    if (!src) return [];
    const res = await fetch(src);
    if (!res.ok) throw new Error('목록을 읽지 못했어요');
    const list = await res.json();
    return Array.isArray(list) ? list.filter((p) => p && typeof p === 'object') : [];
  }
  /** 부품 하나를 정한다 (이미 정한 이름이면 그대로: moida.js를 두 번 실어도 오류 없이) */
  function define(name, make) {
    if (!window.customElements || customElements.get(name)) return;
    customElements.define(name, make());
  }
  addStyle();
`;
