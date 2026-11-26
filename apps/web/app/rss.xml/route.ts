import type { SpaceInfo } from '../_account/types';
import { postUrl, rssResponse } from '../_blog/rss';
import type { PostList, PublicAppList } from '../_blog/types';
import { serverGet } from '../_lib/server-api';

// 사이트 전체 RSS: 공개 앱의 공개 글 20개를 발행한 순서로 (서버의 글 목록 한 쪽이 20개다). 방문자로 묻는다: 주인이 열어도 공개 글만.
// 앱마다는 /<앱>/rss.xml (스토어 1-4).
// 서버에 닿지 못하면 빈 피드 대신 503을 준다: 구독기가 글이 다 사라졌다고 여기지 않게.
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const [space, list, apps] = await Promise.all([
    serverGet<SpaceInfo>('/api/space', true),
    serverGet<PostList>('/api/posts', true),
    serverGet<PublicAppList>('/api/apps', true),
  ]);
  if (!space || !list || !apps) return new Response('', { status: 503 });
  const name = space.name || 'Moida';
  const site = (space.siteUrl ?? new URL(request.url).origin).replace(/\/+$/, '');
  return rssResponse({
    title: name,
    description: space.description || name,
    page: site,
    self: `${site}/rss.xml`,
    posts: list.posts,
    link: (post) => postUrl(post, site, apps.apps),
  });
}
