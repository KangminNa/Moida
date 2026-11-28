import type { NextRequest } from 'next/server';
import { mapSearchAnswer } from '../../../../../_blog/map-search';

// 앱 코드의 장소 · 주소 찾기 (moida.map.search · geocode · reverse, docs/지도.md MP-2). 미리 보기 주소 아래(/<앱>/~<토큰>/_/map/…)는 [[...path]]가 받는다
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ app: string; op: string }> };

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  return mapSearchAnswer(request, (await params).op);
}
