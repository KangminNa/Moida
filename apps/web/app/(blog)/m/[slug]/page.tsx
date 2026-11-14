import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SpaceInfo } from '../../../_account/types';
import { formatDate, menuPath, pagePath } from '../../../_blog/format';
import { PostList } from '../../../_blog/PostList';
import type {
  PostList as PostPage,
  PublicMenu,
  PublicMenuList,
  PublicPageList,
} from '../../../_blog/types';
import { serverGet } from '../../../_lib/server-api';

// 메뉴 하나 (/m/<주소>, 2차 6단계). 종류마다: 글 목록은 그 메뉴의 공개 글, 페이지 모음은 공개 페이지 목록,
// 페이지 하나는 그 페이지를 격리된 틀로. 관리자가 열어도 방문자가 보는 그대로다.
export const dynamic = 'force-dynamic';

/** 페이지의 스크립트는 콘솔과 로그인에 닿지 못한다 (서버의 격리 머리글과 같다) */
const FRAME_SANDBOX =
  'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads';

type Params = { slug: string };

async function menuOf(slug: string): Promise<PublicMenu | null> {
  const list = await serverGet<PublicMenuList>('/api/menus', true);
  return list?.menus.find((m) => m.slug === decodeURIComponent(slug)) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const [space, menu] = await Promise.all([serverGet<SpaceInfo>('/api/space', true), menuOf(slug)]);
  const name = space?.name || 'Cairn';
  const rss = menu?.kind === 'posts' && menu.rss;
  return {
    title: menu ? `${menu.name} · ${name}` : name,
    alternates: rss
      ? { types: { 'application/rss+xml': `${menuPath(menu.slug)}/rss.xml` } }
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
  const [{ slug }, { cursor }] = await Promise.all([params, searchParams]);
  const menu = await menuOf(slug);
  if (!menu) notFound();
  const query = `menu=${encodeURIComponent(menu.slug)}`;
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
            more={
              list.next ? `${menuPath(menu.slug)}?cursor=${encodeURIComponent(list.next)}` : null
            }
          />
        )}
      </main>
    );
  }
  const pages = (await serverGet<PublicPageList>(`/api/pages?${query}`, true))?.pages ?? [];
  const [single] = pages;
  if (menu.kind === 'page')
    return (
      <main className="blog-main wide">
        {single ? (
          <iframe
            className="menu-frame"
            title={single.title}
            src={`${pagePath(single.name)}/index.html`}
            sandbox={FRAME_SANDBOX}
          />
        ) : (
          <p className="blog-empty">공개한 페이지 없음</p>
        )}
      </main>
    );
  return (
    <main className="blog-main">
      <h1 className="blog-menu-title">{menu.name}</h1>
      {pages.length === 0 ? (
        <p className="blog-empty">공개한 {menu.kind === 'issues' ? '호' : '페이지'} 없음</p>
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
