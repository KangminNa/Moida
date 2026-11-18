import Mustache from 'mustache';
import { renderMarkdown } from '../_lib/markdown';
import { formatDate } from './format';
import type { AppScreen, AppScreenData } from './types';

// 앱 화면 그리기 (스토어 1-6, docs/스토어.md 9.3 · 9.4): 서버가 준 앱 코드의 템플릿(Mustache, 로직 없음)에 데이터를 채운다.
// 앱 코드는 실행하지 않는다: 템플릿은 글자를 바꿔 끼우는 틀일 뿐이고, 결과 HTML은 격리 머리글(sandbox)과 함께 브라우저로 간다.
// mustache 라이브러리는 이 파일에서만 가져온다 (객체설계 10장, 결재 2026-11-18).

// 템플릿을 고칠 때마다 새 글자라 담아 두지 않는다 (버전마다 쌓이지 않게)
Mustache.templateCache = undefined;

/** 글 사진 주소 (/api/files/<해시>) */
const FILE_SRC = /(src=")(\/api\/files\/[0-9a-f]+)(")/g;

/** 웹이 데이터에 더하는 것: 글 본문의 HTML · 날짜 글자 · 사이트 이름 (서버는 방문자 데이터만 준다) */
function enrich(
  data: AppScreenData,
  siteName: string,
  ticket: string | null,
): Record<string, unknown> {
  const withDates = addDates(data) as Record<string, unknown>;
  const post = withDates.post as Record<string, unknown> | null;
  if (post) {
    // 서버의 md → HTML은 본문의 HTML을 그리지 않고 결과를 한 번 더 거른다 (_lib/markdown.ts)
    const html = renderMarkdown(String(post.body ?? ''));
    // 미리 보기는 격리된 화면이라 쿠키가 실리지 않는다: 비공개 앱 글의 사진은 토큰으로 연다
    post.html =
      ticket === null
        ? html
        : html.replace(
            FILE_SRC,
            (_, open, src, close) => `${open}${src}?ticket=${encodeURIComponent(ticket)}${close}`,
          );
    delete post.body;
  }
  withDates.site = { ...(withDates.site as object), name: siteName };
  return withDates;
}

/** date(ISO)가 있는 객체마다 dateText를 더한 사본 */
function addDates(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(addDates);
  if (value === null || typeof value !== 'object') return value;
  const copy: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) copy[key] = addDates(inner);
  if (typeof copy.date === 'string' || copy.date === null)
    copy.dateText = formatDate(copy.date as string | null);
  return copy;
}

/** 앱 JS가 읽는 데이터 블록. </script>로 끝나지 않게 <를 바꿔 싣는다 */
function dataBlock(data: Record<string, unknown>): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<script type="application/json" id="cairn-data">${json}</script>`;
}

/** 템플릿을 채운 HTML. ticket은 미리 보기 토큰. 템플릿 문법이 틀리면 Error (부르는 쪽이 500으로) */
export function renderAppScreen(
  screen: AppScreen,
  template: string,
  siteName: string,
  ticket: string | null,
): string {
  const data = enrich(screen.data, siteName, ticket);
  const templates = screen.templates as Record<string, string>;
  const html = Mustache.render(
    templates[template] ?? '',
    data,
    (name) => templates[`${name}.html`],
  );
  const block = dataBlock(data);
  const head = html.search(/<\/head>/i);
  return head >= 0 ? `${html.slice(0, head)}${block}${html.slice(head)}` : `${block}${html}`;
}

/**
 * 앱 화면 · 앱 파일의 격리 머리글. 출처 없는 문서로 열려 앱의 스크립트가 로그인 · 콘솔 API에 닿지 못한다 (sandbox에
 * allow-same-origin 없음). 불러오기는 이 사이트와 그 버전의 cairn.json 바깥 주소만 (그림은 글 본문이 쓰는 https 어디서나).
 * 출처 없는 문서에서 'self'가 맞지 않는 브라우저가 있어 사이트 주소를 그대로 적는다
 */
export function appHeaders(site: string, hosts: readonly string[], preview: boolean): Headers {
  const outside = hosts.map((h) => `https://${h}`).join(' ');
  const from = `${site} ${outside}`.trim();
  const only = (list: string) => list || "'none'";
  const policy = [
    'sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads',
    `default-src ${from}`,
    `script-src ${from} 'unsafe-inline'`,
    `style-src ${from} 'unsafe-inline'`,
    `img-src ${from} data: blob: https:`,
    `font-src ${from} data:`,
    `connect-src ${only(outside)}`,
    `form-action ${only(outside)}`,
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'self'",
  ].join('; ');
  return new Headers({
    'Content-Security-Policy': policy,
    'X-Content-Type-Options': 'nosniff',
    // 미리 보기 주소에는 토큰이 들어 있어 어디에도 싣지 않는다
    'Referrer-Policy': preview ? 'no-referrer' : 'strict-origin-when-cross-origin',
    'Cache-Control': preview ? 'private, no-store' : 'no-cache',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
}
