import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { appPath, postPath, slugFrom } from '../../../../_blog/format';
import { PostArticle } from '../../../../_blog/PostArticle';
import { siteNow } from '../../../../_blog/site';
import type { PostPage } from '../../../../_blog/types';
import { serverGet } from '../../../../_lib/server-api';

// 앱의 글 페이지 (/<앱>/posts/<글>, 스토어 1-4). 방문자는 공개 · 링크 공개 글을, 관리자는 초안도 미리 본다 (서버가 보는 사람마다 거른다).
// 다른 앱의 글이면 고정 주소(/posts/<글>)로 넘겨 지금 든 앱을 찾게 한다. 링크 공개 · 초안은 검색 엔진에 알리지 않는다 (noindex).
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ app: string; slug: string }> };

const load = (raw: string) =>
  serverGet<PostPage>(`/api/posts/by-slug/${encodeURIComponent(slugFrom(raw))}`);

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const [post, site] = await Promise.all([load((await params).slug), siteNow()]);
  if (!post) return {};
  const name = site?.space.name;
  return {
    title: name ? `${post.title} · ${name}` : post.title,
    description: post.excerpt,
    robots: post.listed ? undefined : { index: false, follow: false },
  };
}

export default async function AppPost({ params }: Params) {
  const { app, slug } = await params;
  const post = await load(slug);
  if (!post) notFound();
  if (post.app?.slug !== slugFrom(app)) redirect(postPath(post.slug, null));
  return <PostArticle post={post} back={appPath(post.app.slug)} />;
}
