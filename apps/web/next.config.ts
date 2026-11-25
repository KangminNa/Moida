import type { NextConfig } from 'next';
import { devOrigins } from './app/_lib/dev-origins';
import { APP_SCREEN_ROOTS, SCREEN_HEADERS } from './app/_lib/screen-headers';

// 외부 주소는 하나: /api · /mcp · /oauth · /.well-known · /pages 는 서버로, 나머지는 웹.
// 운영에서는 리버스 프록시가 나누고, 웹 하나만 열어 둔 개발 환경에서는 여기서 서버로 넘긴다.
const server = process.env.API_URL ?? 'http://localhost:4000';

// 개발 서버는 정해 둔 주소가 아니면 화면 스크립트를 막아서, 127.0.0.1로 열면 버튼이 눌리지 않는다.
// 사이트 주소의 쓰기 확인도 한 주소만 받으므로 다른 이름으로 열지 않게 정해 둔 주소로 보낸다.
function localHostRedirect() {
  const home = process.env.CAIRN_WEB_URL;
  if (process.env.NODE_ENV !== 'development' || !home?.includes('//localhost')) return [];
  return [
    {
      source: '/:path*',
      has: [{ type: 'host' as const, value: '127.0.0.1' }],
      destination: `${home}/:path*`,
      permanent: false,
    },
  ];
}

// 모든 화면에 붙이는 보안 머리글 (목록은 app/_lib/screen-headers.ts, proxy.ts와 함께 쓴다)
const securityHeaders = [...SCREEN_HEADERS];

// 페이지(/pages/…)는 서버가 격리 머리글(sandbox · frame-ancestors 'self')을 붙여 보낸다.
// 화면의 frame-ancestors 'none' · X-Frame-Options를 함께 붙이면 콘솔의 미리 보기(틀)도 막히므로 그 둘만 뺀다.
const PAGE_FRAME_HEADERS = new Set([
  'Content-Security-Policy',
  'X-Frame-Options',
  'Referrer-Policy',
]);
const pageHeaders = securityHeaders.filter((h) => !PAGE_FRAME_HEADERS.has(h.key));

// 결과물 공유 링크(/share/<토큰>, 기획서 결정 2026-11-19)도 서버가 격리 머리글(sandbox · frame-ancestors 'none' · no-referrer)을 붙여 보낸다.
// 화면의 CSP · Referrer-Policy를 함께 붙이면 서버의 것을 덮어 격리가 풀릴 수 있어 그 둘만 뺀다 (X-Frame-Options DENY는 둔다)
/**
 * 대화 결과 HTML (/admin/chats/<대화>/report, 2026-11-23): AI가 쓴 답을 담은 독립 문서라 스크립트 없이 격리한다.
 * 스타일은 문서 안의 것만, 그림은 https · 이 사이트, 링크는 새 창으로만 열린다. 콘솔 경로의 머리글 뒤에 적어 덮는다
 */
const REPORT_HEADERS = [
  {
    key: 'Content-Security-Policy',
    value:
      "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  },
  { key: 'Referrer-Policy', value: 'no-referrer' },
];

const SHARE_OWN_HEADERS = new Set(['Content-Security-Policy', 'Referrer-Policy']);
const shareHeaders = securityHeaders.filter((h) => !SHARE_OWN_HEADERS.has(h.key));

// 웹이 그리는 화면의 최상위 경로 (서버로 넘기는 경로 포함). 화면 머리글은 이 경로와 첫 화면(/)에만 붙인다.
// 그 밖의 /<이름>/…은 앱 화면(스토어 1-6)이라 route handler가 앱마다 격리 머리글을 붙인다: 화면의 frame-ancestors 'none' ·
// X-Frame-Options가 함께 붙으면 콘솔의 미리 보기가 막히고 CSP 둘이 겹친다. 구조 검사가 app/ 폴더 · App.RESERVED와 맞춰 본다
const WEB_ROUTES = [
  'admin',
  'api',
  'connect',
  'graph',
  'install',
  'login',
  'm',
  'mcp',
  'oauth',
  'posts',
];
// 콘솔(/admin)만 다른 창과의 연결을 끊는다 (Cross-Origin-Opener-Policy, 웹 보안 S2): AI가 만든 페이지 · 앱 화면은 링크를
// 격리 밖의 새 창으로 열 수 있어(allow-popups-to-escape-sandbox), 연 쪽이 그 창(콘솔)을 가짜 화면으로 바꿔치기할 수 있다.
// /connect · /login에는 넣지 않는다: Claude · ChatGPT 앱 연결이 이 화면을 팝업으로 열고 돌아오는 흐름이 끊긴다
const consoleHeaders = [{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin' }];

/** 웹이 내는 파일 (route handler · Next가 만드는 것) */
const WEB_FILES = ['rss.xml', 'sw.js', 'manifest.webmanifest', 'favicon.ico', 'cairn.svg'];

const config: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: devOrigins(process.env),
  async redirects() {
    return localHostRedirect();
  },
  async headers() {
    // 첫 화면(/) · /posts · /m은 앱 도메인에서 앱 화면이 되어(스토어 3-0) 여기서 붙이면 앱 화면의 격리 머리글을 덮는다.
    // 그 셋의 화면 머리글은 proxy.ts가 기본 도메인에서만 붙인다
    const routes = WEB_ROUTES.filter((r) => !APP_SCREEN_ROOTS.includes(r)).join('|');
    return [
      { source: '/admin', headers: consoleHeaders },
      { source: '/admin/:rest*', headers: consoleHeaders },
      { source: `/:route(${routes})`, headers: securityHeaders },
      { source: `/:route(${routes})/:rest*`, headers: securityHeaders },
      {
        source: `/:file(${WEB_FILES.map((f) => f.replace('.', '\\.')).join('|')})`,
        headers: securityHeaders,
      },
      { source: '/_next/:rest*', headers: securityHeaders },
      { source: '/.well-known/:rest*', headers: securityHeaders },
      // 공개 페이지 목록(/pages)은 화면이라 화면의 머리글을 받는다
      { source: '/pages', headers: securityHeaders },
      { source: '/pages/:path+', headers: pageHeaders },
      { source: '/share/:token', headers: shareHeaders },
      { source: '/admin/chats/:id/report', headers: REPORT_HEADERS },
    ];
  },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${server}/api/:path*` },
      { source: '/mcp', destination: `${server}/mcp` },
      { source: '/oauth/:path*', destination: `${server}/oauth/:path*` },
      { source: '/.well-known/:path*', destination: `${server}/.well-known/:path*` },
      // AI가 만든 페이지의 바깥 주소 (기획서 12장 2026-11-12). 파일은 서버가 내보낸다
      { source: '/pages/:path+', destination: `${server}/api/pages/site/:path+` },
      // 결과물 공유 링크 (기획서 결정 2026-11-19). 파일과 격리 머리글은 서버가 낸다
      { source: '/share/:token', destination: `${server}/api/output-shares/open/:token` },
    ];
  },
};

export default config;
