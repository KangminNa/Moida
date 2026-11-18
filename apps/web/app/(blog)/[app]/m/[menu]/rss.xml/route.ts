import { menuPath } from '../../../../../_blog/format';
import { rssResponse } from '../../../../../_blog/rss';
import { siteNow } from '../../../../../_blog/site';
import type { PostList, PublicMenuList } from '../../../../../_blog/types';
import { serverGet } from '../../../../../_lib/server-api';

// 앱의 메뉴 RSS (/<앱>/m/<메뉴>/rss.xml): 공개 앱의 글 목록 메뉴이고 RSS를 켠 것만. 그 밖에는 없는 피드(404).
// 서버에 닿지 못하면 503: 구독기가 글이 다 사라졌다고 여기지 않게.
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ app: string; menu: string }> },
): Promise<Response> {
  const found = await params;
  const [app, slug] = [found.app, found.menu].map((s) => decodeURIComponent(s));
  const [site, menus] = await Promise.all([
    siteNow(),
    serverGet<PublicMenuList>(`/api/menus?app=${encodeURIComponent(app ?? '')}`, true),
  ]);
  if (!site || !menus) return new Response('', { status: 503 });
  const menu = menus.menus.find((m) => m.slug === slug);
  if (!menu || menu.kind !== 'posts' || !menu.rss) return new Response('', { status: 404 });
  const query = `app=${encodeURIComponent(menu.app)}&menu=${encodeURIComponent(menu.slug)}`;
  const list = await serverGet<PostList>(`/api/posts?${query}`, true);
  if (!list) return new Response('', { status: 503 });
  const { space } = site;
  const page = menuPath(menu.slug, menu.app);
  return rssResponse({
    site: (space.siteUrl ?? new URL(request.url).origin).replace(/\/+$/, ''),
    title: `${menu.name} · ${space.name || 'Cairn'}`,
    description: space.description || space.name || 'Cairn',
    page,
    self: `${page}/rss.xml`,
    posts: list.posts,
  });
}
