import type { SpaceInfo } from '../../../../_account/types';
import { menuPath } from '../../../../_blog/format';
import { rssResponse } from '../../../../_blog/rss';
import type { PostList, PublicMenuList } from '../../../../_blog/types';
import { serverGet } from '../../../../_lib/server-api';

// 메뉴의 RSS (2차 6단계): 글 목록 메뉴이고 RSS를 켠 것만. 그 밖에는 없는 피드(404).
// 서버에 닿지 못하면 503: 구독기가 글이 다 사라졌다고 여기지 않게.
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const slug = decodeURIComponent((await params).slug);
  const [space, menus] = await Promise.all([
    serverGet<SpaceInfo>('/api/space', true),
    serverGet<PublicMenuList>('/api/menus', true),
  ]);
  if (!space || !menus) return new Response('', { status: 503 });
  const menu = menus.menus.find((m) => m.slug === slug);
  if (!menu || menu.kind !== 'posts' || !menu.rss) return new Response('', { status: 404 });
  const list = await serverGet<PostList>(`/api/posts?menu=${encodeURIComponent(slug)}`, true);
  if (!list) return new Response('', { status: 503 });
  const name = space.name || 'Cairn';
  const page = menuPath(menu.slug);
  return rssResponse({
    site: (space.siteUrl ?? new URL(request.url).origin).replace(/\/+$/, ''),
    title: `${menu.name} · ${name}`,
    description: space.description || name,
    page,
    self: `${page}/rss.xml`,
    posts: list.posts,
  });
}
