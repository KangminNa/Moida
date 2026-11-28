// 앱 화면 주소(/<앱>/…)에서 앱 코드를 거치지 않고 Moida이 직접 내는 답 (스토어 1-6): 없는 페이지 · 그리지 못한 화면.
// route handler는 React 화면을 그리지 않으므로 not-found.tsx와 같은 모양을 HTML 글로 둔다.
// 없는 앱 · 비공개 앱 · 틀린 토큰 · 웹의 다른 없는 주소가 모두 이 한 답이라 앱이 있다는 사실이 드러나지 않는다 (원칙 5).

/** Moida이 그리는 화면의 머리글 (next.config의 화면 머리글과 같다: 다른 사이트가 겹쳐 놓지 못하게) */
const SCREEN_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

/** 중립 회색 바탕에 가운데 글 두 줄 (기기의 어두운 화면을 따른다) */
const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#18181b;--muted:#4b4b52;--line:#e4e4e7}
@media (prefers-color-scheme:dark){:root{--bg:#18181b;--fg:#f4f4f5;--muted:#b4b4bb;--line:#2a2a2f}}
body{margin:0;background:var(--bg);color:var(--fg);font-family:"Pretendard Variable",Pretendard,-apple-system,system-ui,sans-serif;word-break:keep-all}
main{display:flex;flex-direction:column;align-items:center;gap:8px;padding:96px 20px;text-align:center}
.code{margin:0;color:var(--muted);font-size:.9rem;font-weight:600;letter-spacing:.08em}
h1{margin:0 0 16px;font-size:1.6rem}
p{margin:0;color:var(--muted)}
a{display:block;padding:12px 20px;border:1px solid var(--line);border-radius:8px;color:var(--muted);text-decoration:none}`;

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

function html(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c);
}

function page(status: number, title: string, detail: string | null): Response {
  const body = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${html(title)}</title><style>${STYLE}</style></head><body><main><p class="code">${status}</p><h1>${html(title)}</h1>${detail ? `<p>${html(detail)}</p>` : ''}<a href="/">첫 화면으로</a></main></body></html>`;
  return new Response(body, { status, headers: SCREEN_HEADERS });
}

/** 없는 페이지 (404) */
export function missingAnswer(): Response {
  return page(404, '없는 페이지', null);
}

/** 앱 코드의 템플릿을 채우지 못함 (500). detail은 미리 보기에만: 방문자에게는 앱 코드의 오류를 보이지 않는다 */
export function brokenAnswer(detail: string | null): Response {
  return page(500, '앱 화면을 그리지 못했어요', detail);
}

/** 서버에 닿지 못함 (503) */
export function unreachableAnswer(): Response {
  return page(503, '서버에 연결하지 못했어요', null);
}
