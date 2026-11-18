import type { SpaceInfo } from '../_account/types';
import { rssResponse } from '../_blog/rss';
import type { PostList } from '../_blog/types';
import { serverGet } from '../_lib/server-api';

// 사이트 전체 RSS: 공개 앱의 공개 글 20개를 발행한 순서로 (서버의 글 목록 한 쪽이 20개다). 방문자로 묻는다: 주인이 열어도 공개 글만.
// 앱마다는 /<앱>/rss.xml (스토어 1-4).
// 서버에 닿지 못하면 빈 피드 대신 503을 준다: 구독기가 글이 다 사라졌다고 여기지 않게.
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const [space, list] = await Promise.all([
    serverGet<SpaceInfo>('/api/space', true),
    serverGet<PostList>('/api/posts', true),
  ]);
  if (!space || !list) return new Response('', { status: 503 });
  const name = space.name || 'Cairn';
  return rssResponse({
    site: (space.siteUrl ?? new URL(request.url).origin).replace(/\/+$/, ''),
    title: name,
    description: space.description || name,
    page: '/',
    self: '/rss.xml',
    posts: list.posts,
  });
}
