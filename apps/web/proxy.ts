import { type NextRequest, NextResponse } from 'next/server';
import { RETURN_HEADER } from './app/_lib/return-path';

// 콘솔(/admin) 요청에 지금 주소를 머리글로 붙인다 (웹 UX U2). 콘솔 틀(admin/layout)은 서버에서 그려 지금 주소를 모르는데,
// 로그인이 끝났으면 다시 로그인한 뒤 보던 주소로 돌아오게 로그인 화면에 넘겨야 한다.
// 막는 일은 하지 않는다 (로그인 확인은 서버 API가 한다). 밖에서 같은 머리글을 붙여 와도 여기서 덮어쓰고, 쓰는 쪽이 safeReturnPath로 다시 거른다.
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(RETURN_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ['/admin', '/admin/:path*'] };
