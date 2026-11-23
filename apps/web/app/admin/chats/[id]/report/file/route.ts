import type { NextRequest } from 'next/server';
import { reportAnswer } from '../../report-answer';

// 대화 회차 하나의 결과 HTML을 파일로 (/admin/chats/<대화>/report/file?turn=<회차>, 2026-11-23).
// 보기 주소(…/report)와 나눈 까닭: 보기에 붙는 격리 머리글(sandbox)이 있으면 브라우저가 파일 이름을 버린다
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  return reportAnswer(request, (await params).id, true);
}
