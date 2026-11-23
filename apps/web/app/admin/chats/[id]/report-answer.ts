import type { NextRequest } from 'next/server';
import type { SpaceInfo } from '../../../_account/types';
import { loginPath } from '../../../_lib/return-path';
import { serverFetch, serverGet } from '../../../_lib/server-api';
import { chatReportHtml, reportFileName, reportTurn } from '../../../_task/chat-report';
import type { ChatDetail } from '../../../_task/types';

// 대화 회차 하나의 결과 HTML의 답 (보기 …/report, 파일 …/report/file이 함께 쓴다, 2026-11-23).
// 회차(?turn=)를 주지 않으면 답이 있는 마지막 회차. 관리자만 (대화 API가 거른다, 로그인이 끝났으면 로그인 화면으로)
export async function reportAnswer(
  request: NextRequest,
  id: string,
  file: boolean,
): Promise<Response> {
  const query = request.nextUrl.searchParams;
  const reply = await serverFetch<ChatDetail>(`/api/chats/${encodeURIComponent(id)}`);
  if (reply.status === 401 || reply.status === 403) {
    const back = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    return Response.redirect(new URL(loginPath(back), request.nextUrl.origin), 303);
  }
  if (reply.status !== 200 || !reply.data) return text('없는 대화예요', 404);
  const turnNumber = /^\d{1,5}$/.test(query.get('turn') ?? '') ? Number(query.get('turn')) : null;
  const turn = reportTurn(reply.data, turnNumber);
  if (!turn) return text('정리할 답이 아직 없어요', 404);
  const space = await serverGet<SpaceInfo>('/api/space', true);
  const site = new URL(space?.siteUrl || request.nextUrl.origin).origin;
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'private, no-store',
  });
  if (file)
    headers.set(
      'Content-Disposition',
      `attachment; filename="report.html"; filename*=UTF-8''${encodeURIComponent(reportFileName(reply.data, turn))}`,
    );
  return new Response(chatReportHtml(reply.data, turn, site), { status: 200, headers });
}

function text(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
