import type { NextRequest } from 'next/server';
import { serverFetch } from '../_lib/server-api';

// 앱 코드의 장소 · 주소 찾기 (moida.map.search · geocode · reverse, docs/지도.md MP-2): GET <앱 주소>/_/map/<동작>?…
// 지도 플러그인의 서버 경로(/api/p/map/<동작>)로 넘긴다. 서버 키는 서버에만 있고, 방문자 주소(x-forwarded-for)를 함께 넘겨
// 서버가 곳마다 횟수를 센다. 쿠키는 넘기지 않고(방문자로), 격리된 화면(출처 없는 문서)도 부르게 모든 출처에 연다.
// 앱 도메인에서는 /api가 닫혀 있어 앱 주소 아래로 받는다 (moida.data와 같은 길)

const OPERATIONS = ['search', 'geocode', 'reverse'] as const;
/** 넘기는 칸 (그 밖의 칸은 버린다) */
const FIELDS = ['q', 'lat', 'lng', 'size', 'address'] as const;

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

/** op: 주소의 마지막 마디 (search · geocode · reverse) */
export async function mapSearchAnswer(request: NextRequest, op: string): Promise<Response> {
  if (!(OPERATIONS as readonly string[]).includes(op))
    return json(404, { message: '없는 주소예요' });
  const asked = request.nextUrl.searchParams;
  const query = new URLSearchParams();
  for (const name of FIELDS) {
    const value = asked.get(name);
    if (value !== null) query.set(name, value.slice(0, 200));
  }
  const reply = await serverFetch<unknown>(`/api/p/map/${op}?${query}`, true);
  if (reply.status === 0) return json(503, { message: '서버에 닿지 못했어요' });
  return json(reply.status, reply.data ?? { message: '찾지 못했어요' });
}
