import { menuPath } from '../../../../_blog/format';
import type { PublicMenuList } from '../../../../_blog/types';
import { serverGet } from '../../../../_lib/server-api';

// 옛 메뉴 RSS /m/<메뉴>/rss.xml (스토어 1-4): 그 메뉴가 있는 첫 공개 앱의 피드로 (307). 없으면 404,
// 서버에 닿지 못하면 503: 구독기가 피드가 사라졌다고 여기지 않게.
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const slug = decodeURIComponent((await params).slug);
  const menus = await serverGet<PublicMenuList>('/api/menus', true);
  if (!menus) return new Response('', { status: 503 });
  const menu = menus.menus.find((m) => m.slug === slug);
  if (!menu) return new Response('', { status: 404 });
  // 상대 주소로 넘긴다: 앞의 프록시 뒤에서 웹 서버가 보는 주소(내부 주소)가 새지 않게
  return new Response(null, {
    status: 307,
    headers: { Location: `${menuPath(menu.slug, menu.app)}/rss.xml` },
  });
}
