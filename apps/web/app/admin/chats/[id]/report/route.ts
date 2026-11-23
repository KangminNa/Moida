import type { NextRequest } from 'next/server';
import { reportAnswer } from '../report-answer';

// 대화 회차 하나의 결과 HTML 보기 (/admin/chats/<대화>/report?turn=<회차>, 2026-11-23). 파일로는 …/report/file.
// 격리 머리글(스크립트 없음)은 next.config의 REPORT_HEADERS가 붙인다: 콘솔 경로의 머리글이 route handler의 것을 덮어서다
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  return reportAnswer(request, (await params).id, false);
}
