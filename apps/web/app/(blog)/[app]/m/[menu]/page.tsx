import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatDate, menuPath, pagePath, slugFrom } from '../../../../_blog/format';
import { PageFrame } from '../../../../_blog/PageFrame';
import { PostList } from '../../../../_blog/PostList';
import { siteNow } from '../../../../_blog/site';
import type {
  PostList as PostPage,
  PublicIssueList,
  PublicMenu,
  PublicMenuList,
  PublicPageList,
} from '../../../../_blog/types';
import { serverGet } from '../../../../_lib/server-api';

// 앱의 메뉴 하나 (/<앱>/m/<주소>, 스토어 1-4. 메뉴 주소는 앱 안에서 하나). 종류마다: 글 목록은 그 메뉴의 공개 글,
// 호 목록은 발행한 호, 페이지 모음은 공개 페이지 목록, 페이지 하나는 그 페이지를 격리된 틀로. 관리자가 열어도 방문자가 보는 그대로다.
export const dynamic = 'force-dynamic';

type Params = { app: string; menu: string };

async function menuOf({ app, menu }: Params): Promise<PublicMenu | null> {
  const list = await serverGet<PublicMenuList>(
    `/api/menus?app=${encodeURIComponent(slugFrom(app))}`,
    true,
  );
  return list?.menus.find((m) => m.slug === slugFrom(menu)) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const found = await params;
  const [site, menu] = await Promise.all([siteNow(), menuOf(found)]);
  const name = site?.space.name || 'Cairn';
  const rss = menu?.kind === 'posts' && menu.rss;
  return {
    title: menu ? `${menu.name} · ${name}` : name,
    alternates: rss
      ? { types: { 'application/rss+xml': `${menuPath(menu.slug, menu.app)}/rss.xml` } }
      : undefined,
  };
}

export default async function MenuScreen({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const [found, { cursor }] = await Promise.all([params, searchParams]);
  const menu = await menuOf(found);
  if (!menu) notFound();
  const here = menuPath(menu.slug, menu.app);
  const query = `app=${encodeURIComponent(menu.app)}&menu=${encodeURIComponent(menu.slug)}`;
  if (menu.kind === 'posts') {
    const after = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const list = await serverGet<PostPage>(`/api/posts?${query}${after}`, true);
    return (
      <main className="blog-main">
        <h1 className="blog-menu-title">{menu.name}</h1>
        {!list ? (
          <p className="blog-empty">서버에 연결하지 못했어요</p>
        ) : (
          <PostList
            posts={list.posts}
            more={list.next ? `${here}?cursor=${encodeURIComponent(list.next)}` : null}
          />
        )}
      </main>
    );
  }
  if (menu.kind === 'issues') {
    const issues = (await serverGet<PublicIssueList>(`/api/issues?${query}`, true))?.issues ?? [];
    return (
      <main className="blog-main">
        <h1 className="blog-menu-title">{menu.name}</h1>
        {issues.length === 0 ? (
          <p className="blog-empty">발행한 호 없음</p>
        ) : (
          <ol className="post-list">
            {issues.map((i) => (
              <li key={i.number}>
                <a href={`${here}/${i.number}`}>
                  <h2>
                    {i.number}호 · {i.title}
                  </h2>
                  {i.intro && <p>{i.intro}</p>}
                  <div className="post-meta">
                    <time dateTime={i.publishedAt ?? undefined}>{formatDate(i.publishedAt)}</time>
                  </div>
                </a>
              </li>
            ))}
          </ol>
        )}
      </main>
    );
  }
  const pages = (await serverGet<PublicPageList>(`/api/pages?${query}`, true))?.pages ?? [];
  const [single] = pages;
  if (menu.kind === 'page')
    return (
      <main className="blog-main wide">
        {single ? <PageFrame page={single} /> : <p className="blog-empty">공개한 페이지 없음</p>}
      </main>
    );
  return (
    <main className="blog-main">
      <h1 className="blog-menu-title">{menu.name}</h1>
      {pages.length === 0 ? (
        <p className="blog-empty">공개한 페이지 없음</p>
      ) : (
        <ol className="post-list">
          {pages.map((p) => (
            <li key={p.name}>
              <a href={pagePath(p.name)}>
                <h2>{p.title}</h2>
                <div className="post-meta">
                  <time dateTime={p.updatedAt}>{formatDate(p.updatedAt)}</time>
                </div>
              </a>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
