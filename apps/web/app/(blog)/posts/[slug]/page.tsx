import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { postPath, slugFrom } from '../../../_blog/format';
import { PostArticle } from '../../../_blog/PostArticle';
import { SiteHeader } from '../../../_blog/SiteHeader';
import { siteNow } from '../../../_blog/site';
import type { PostPage } from '../../../_blog/types';
import { serverGet } from '../../../_lib/server-api';

// 글의 고정 주소 (스토어 1-4). 그래프 · 편집기 · 옛 링크가 앱을 모른 채 가리킨다.
// 방문자에게 보이는 글이면 지금 든 앱의 주소(/<앱>/posts/<글>)로 넘긴다: 글은 다른 앱으로 옮길 수 있어 307 (308은 브라우저가 기억한다).
// 방문자에게 안 보이는 글(초안 · 비공개 앱 · 앱 밖)은 관리자에게만 여기서 미리 보기로 그린다. 링크 공개 · 초안은 noindex.
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

const byslug = (raw: string) => `/api/posts/by-slug/${encodeURIComponent(slugFrom(raw))}`;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const [post, site] = await Promise.all([
    serverGet<PostPage>(byslug((await params).slug)),
    siteNow(),
  ]);
  if (!post) return {};
  const name = site?.space.name;
  return {
    title: name ? `${post.title} · ${name}` : post.title,
    robots: { index: false, follow: false },
  };
}

export default async function FixedPost({ params }: Params) {
  const { slug } = await params;
  const open = await serverGet<PostPage>(byslug(slug), true);
  if (open?.app) redirect(postPath(open.slug, open.app.slug));
  const [post, site] = await Promise.all([serverGet<PostPage>(byslug(slug)), siteNow()]);
  if (!post) notFound();
  return (
    <>
      {site && <SiteHeader site={site} brand />}
      <PostArticle post={post} back="/" hidden />
    </>
  );
}
