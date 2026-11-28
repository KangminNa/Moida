import { deployEnv } from './deploy-env.ts';

// 개발 서버(next dev)가 받는 개발용 요청(/_next/hmr 등)의 출처 (next.config의 allowedDevOrigins).
// 개발 서버는 localhost가 아닌 주소에서 온 개발용 요청을 막고, 막히면 화면의 JS가 하이드레이션하지 않아 버튼이 눌리지 않는다.
// 허락하는 호스트:
// - 사람이 여는 웹 주소(MOIDA_WEB_URL)의 호스트 (테스트 서버처럼 도메인으로 여는 개발 서버)
// - 앱 도메인 (스토어 3-0): 앱 도메인은 localhost를 받지 않아 로컬에서는 `<이름>.test`(hosts 파일)로 연다.
//   허락하지 않으면 앱 도메인의 회원 화면(/_/login …)이 개발 서버에서 눌리지 않는다 (2026-11-25).
//   .test는 시험용으로 정해 둔 최상위 이름이라 기본으로 허락하고, 다른 이름은 MOIDA_DEV_ORIGINS(쉼표, `*.example.com`도)로 더한다.
// 운영 빌드(next start)에는 상관없는 설정이다.
export function devOrigins(env: Readonly<Record<string, string | undefined>>): string[] {
  const extra = (deployEnv('DEV_ORIGINS', env) ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== '');
  return [...webHost(deployEnv('WEB_URL', env)), '**.test', ...extra];
}

function webHost(url: string | undefined): string[] {
  if (!url || !URL.canParse(url)) return [];
  return [new URL(url).hostname];
}
