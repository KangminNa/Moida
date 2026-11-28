import type { NextRequest } from 'next/server';
import { appDataAnswer } from '../../../../_blog/app-data';
import { slugFrom } from '../../../../_blog/format';

// 앱 코드가 부르는 화면 데이터 (moida.data, docs/스토어.md 14장 A3). 미리 보기 주소 아래(/<앱>/~<토큰>/_/data)는 [[...path]]가 받는다
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ app: string }> };

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  return appDataAnswer(request, slugFrom((await params).app), null);
}
