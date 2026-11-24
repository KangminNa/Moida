import { ApiConnectorPanel } from './ApiConnectorPanel';
import { ExternalToolPanel } from './ExternalToolPanel';

export const metadata = { title: '외부 도구 · Cairn', robots: { index: false } };

// 외부 도구 메뉴 (2차 7단계, API 커넥터 2026-11-24). 페이지는 틀만 두고, 읽기·쓰기는 클라이언트 패널이 서버 API로 한다.
// OAuth 로그인(C1)에서 돌아오면 서버가 ?connected=<커넥터 id> 또는 ?oauth_error=<까닭>을 붙여 보낸다.
export default async function ExternalToolPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; oauth_error?: string }>;
}) {
  const { connected, oauth_error: problem } = await searchParams;
  return (
    <section className="console-inner narrow" aria-label="외부 도구">
      <ExternalToolPanel connected={connected ?? null} oauthProblem={problem ?? null} />
      <ApiConnectorPanel />
    </section>
  );
}
