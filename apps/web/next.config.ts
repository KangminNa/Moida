import type { NextConfig } from 'next';

// 외부 주소는 하나: /api · /mcp · /oauth · /.well-known · /pages 는 서버로, 나머지는 웹.
// 운영에서는 리버스 프록시가 나누고, 웹 하나만 열어 둔 개발 환경에서는 여기서 서버로 넘긴다.
const server = process.env.API_URL ?? 'http://localhost:4000';

// 개발 서버(next dev)는 localhost가 아닌 주소에서 온 개발용 요청(/_next/hmr 등)을 막고, 막히면 화면의 JS가 돌지 않는다.
// 테스트 서버처럼 도메인으로 여는 개발 서버를 위해 사람이 여는 웹 주소(CAIRN_WEB_URL)의 호스트를 허락한다.
// 운영 빌드(next start)에는 상관없는 설정이다.
function devOrigins(): string[] {
  try {
    return process.env.CAIRN_WEB_URL ? [new URL(process.env.CAIRN_WEB_URL).hostname] : [];
  } catch {
    return [];
  }
}

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

// 모든 화면에 붙이는 보안 머리글.
//   frame-ancestors · X-Frame-Options: 다른 사이트가 우리 화면을 겹쳐 놓고 누르게 하지 못하게
//   form-action: 폼은 이 사이트로만 (화면의 폼은 모두 fetch로 보낸다)
//   Referrer-Policy: 다른 사이트로 갈 때 도메인만 넘기고 경로·파라미터는 넘기지 않게
//   Strict-Transport-Security: https로 한 번 온 브라우저는 늘 https로 (http에서는 브라우저가 무시)
// 스크립트 출처까지 막는 전체 CSP는 블로그 화면(M4)에서 플러그인의 외부 스크립트와 함께 정한다.
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
];

// 페이지(/pages/…)는 서버가 격리 머리글(sandbox · frame-ancestors 'self')을 붙여 보낸다.
// 화면의 frame-ancestors 'none' · X-Frame-Options를 함께 붙이면 콘솔의 미리 보기(틀)도 막히므로 그 둘만 뺀다.
const PAGE_FRAME_HEADERS = new Set([
  'Content-Security-Policy',
  'X-Frame-Options',
  'Referrer-Policy',
]);
const pageHeaders = securityHeaders.filter((h) => !PAGE_FRAME_HEADERS.has(h.key));

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
const WEB_FILES = ['rss.xml', 'sw.js', 'manifest.webmanifest', 'favicon.ico'];

const config: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: devOrigins(),
  async redirects() {
    return localHostRedirect();
  },
  async headers() {
    const routes = WEB_ROUTES.join('|');
    return [
      { source: '/', headers: securityHeaders },
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
    ];
  },
};

export default config;
