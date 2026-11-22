import type { NextRequest } from 'next/server';
import { appOfHost } from '../../../../_blog/app-domains';
import { cairnAnswer } from '../../../../_blog/cairn-client';
import { slugFrom } from '../../../../_blog/format';
import { hostOf } from '../../../../_blog/request-host';

// cairn.js (앱 플랫폼, docs/스토어.md 12.4): 앱 코드가 회원 · 앱 데이터 · 커뮤니티를 부르는 스크립트.
// 그 앱의 도메인으로 온 요청에만 열린(open) 스크립트를 준다. 기본 도메인의 /<앱>/_/cairn.js는 닫힌 스크립트다:
// 격리된 화면에서는 회원 · 데이터를 쓰지 못하고, 앱은 cairn.open으로 알고 안내를 그린다
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ app: string }> };

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  const app = slugFrom((await params).app);
  return cairnAnswer((await appOfHost(hostOf(request.headers))) === app);
}
