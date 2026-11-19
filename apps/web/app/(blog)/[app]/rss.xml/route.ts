import { appBase, postUrl, rssResponse } from '../../../_blog/rss';
import { appIn, siteNow } from '../../../_blog/site';
import type { PostList } from '../../../_blog/types';
import { serverGet } from '../../../_lib/server-api';

// 앱의 RSS (/<앱>/rss.xml, 스토어 1-4): 그 앱의 공개 글 20개를 발행한 순서로. 공개 앱이 아니거나 페이지 앱이면 404,
// 서버에 닿지 못하면 503: 구독기가 글이 다 사라졌다고 여기지 않게.
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ app: string }> },
): Promise<Response> {
  const site = await siteNow();
  if (!site) return new Response('', { status: 503 });
  const app = appIn(site, decodeURIComponent((await params).app));
  if (!app || app.kind === 'page') return new Response('', { status: 404 });
  const list = await serverGet<PostList>(`/api/posts?app=${encodeURIComponent(app.slug)}`, true);
  if (!list) return new Response('', { status: 503 });
  const { space } = site;
  const origin = (space.siteUrl ?? new URL(request.url).origin).replace(/\/+$/, '');
  const base = appBase(app, origin);
  return rssResponse({
    title: `${app.name} · ${space.name || 'Cairn'}`,
    description: app.description || space.description || app.name,
    page: base,
    self: `${base}/rss.xml`,
    posts: list.posts,
    link: (post) => postUrl(post, origin, site.apps),
  });
}
