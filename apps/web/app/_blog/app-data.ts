import type { NextRequest } from 'next/server';
import type { SpaceInfo } from '../_account/types';
import { serverFetch, serverGet } from '../_lib/server-api';
import { visitorData } from './app-screen';
import { hostOf } from './request-host';
import type { AppScreen, AppScreenPage, AppScreenRedirect, AppScreenStatic } from './types';

// 앱 코드가 부르는 화면 데이터 (2026-11-25, docs/스토어.md 14장 A3): GET <앱 주소>/_/data?path=<주소>&cursor=<다음 쪽>.
// 그 주소의 데이터 약속(moida: 1: 앱 · 메뉴 · 글 목록 · 글 · 호)을 화면의 데이터 블록과 같은 모양(글 본문은 html)으로 준다. 앱 JS가 템플릿 없이 글 · 메뉴 · 호를 그린다 (moida.data).
// 방문자 데이터만 있다 (초안은 미리 보기에도 없다): 쿠키를 넘기지 않고, 격리된 화면(출처 없는 문서)도 읽게 모든 출처에 연다.
// 없는 앱 · 비공개 앱 · 틀린 토큰은 모두 같은 404다

type Answer = AppScreen | AppScreenRedirect | AppScreenPage | AppScreenStatic;

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': '*',
};

function json(status: number, body: unknown, ticket: string | null): Response {
  const cache = ticket === null && status === 200 ? 'public, max-age=30' : 'no-store';
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...HEADERS, 'Cache-Control': cache },
  });
}

/** app: 앱 주소, ticket: 미리 보기 토큰 */
export async function appDataAnswer(
  request: NextRequest,
  app: string,
  ticket: string | null,
): Promise<Response> {
  const asked = request.nextUrl.searchParams;
  const path = (asked.get('path') ?? '').replace(/^\/+/, '');
  if (path.length > 300 || path.split('/').some((p) => p === '..' || p === '_'))
    return json(400, { message: '읽을 수 없는 주소예요' }, ticket);
  const query = new URLSearchParams({ path });
  const cursor = asked.get('cursor');
  if (cursor) query.set('cursor', cursor.slice(0, 200));
  if (ticket) query.set('ticket', ticket);
  const host = hostOf(request.headers);
  if (host) query.set('host', host);
  const reply = await serverFetch<Answer>(
    `/api/apps/site/${encodeURIComponent(app)}/screen?${query}`,
    true,
  );
  if (reply.status === 0) return json(503, { message: '서버에 닿지 못했어요' }, ticket);
  if (reply.status !== 200 || !reply.data) return json(404, { message: '없는 앱이에요' }, ticket);
  const answer = reply.data;
  // 다른 공개 앱에 든 글 · 확인한 도메인: 데이터 대신 갈 주소를 준다 (앱 JS가 옮겨 간다)
  if (answer.redirect !== null) return json(200, { data: null, redirect: answer.redirect }, ticket);
  if (answer.page !== null) return json(404, { message: '이 앱은 페이지가 화면이에요' }, ticket);
  if (!answer.data) return json(404, { message: '데이터가 없는 주소예요' }, ticket);
  const space = await serverGet<SpaceInfo>('/api/space', true);
  const data = visitorData(answer.data, space?.name || 'Moida', ticket);
  return json(200, { data, redirect: null }, ticket);
}
