import { moidaTypes } from '../../../../_blog/moida-catalog';

// moida.js의 타입 (2026-11-28): 앱 코드 옆의 /_/moida.d.ts. 내 컴퓨터에서 앱을 짤 때 편집기가 moida · 부품 태그를 알게 한다.
// 앱마다 같은 글자다 (켜진 플러그인과 상관없이 목록 전체, moida-catalog.ts)
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return new Response(moidaTypes(), {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
