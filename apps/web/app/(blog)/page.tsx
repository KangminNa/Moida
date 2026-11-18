import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AppGrid } from '../_blog/AppGrid';
import { AppHome } from '../_blog/AppHome';
import { AppShell } from '../_blog/AppShell';
import { SiteFooter } from '../_blog/SiteFooter';
import { SiteHeader } from '../_blog/SiteHeader';
import { siteNow } from '../_blog/site';

// 첫 화면 (스토어 1-4, 시안 6 · 7 · 8번): 공개 앱이 0개면 사이트 이름 · 소개 · "공개한 앱 없음",
// 1개면 그 앱의 첫 화면 그대로, 2개 이상이면 앱 아이콘 목록. 관리자가 열어도 방문자가 보는 그대로다.
export const dynamic = 'force-dynamic';

/** 예전 관리 시트 주소 (?sheet=이름). 이미 저장된 링크가 있어서 콘솔 주소로 넘긴다 */
const OLD_SHEETS: Record<string, string> = {
  sessions: '/admin/sessions',
  posts: '/admin/posts',
  blog: '/admin/site',
  plugins: '/admin/plugins',
  devices: '/admin/devices',
  account: '/admin/account',
};

type Search = { cursor?: string; sheet?: string; session?: string; error?: string };

export async function generateMetadata(): Promise<Metadata> {
  const site = await siteNow();
  return { title: site?.space.name || 'Cairn', description: site?.space.description };
}

function oldSheetPath({ sheet, session, error }: Search): string | null {
  const path = sheet ? OLD_SHEETS[sheet] : undefined;
  if (!path) return null;
  const query = new URLSearchParams();
  if (session) query.set('session', session);
  if (error) query.set('error', error);
  return query.size > 0 ? `${path}?${query}` : path;
}

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const moved = oldSheetPath(search);
  if (moved) redirect(moved);
  const site = await siteNow();
  if (!site)
    return (
      <main className="blog-main">
        <p className="blog-empty">서버에 연결하지 못했어요</p>
      </main>
    );
  if (!site.space.installed) redirect('/install');
  const [only] = site.apps;
  if (only && site.apps.length === 1)
    return (
      <AppShell site={site} app={only}>
        <AppHome app={only} cursor={search.cursor ?? null} />
      </AppShell>
    );
  const { space } = site;
  return (
    <>
      <SiteHeader site={site} brand={false} />
      <main className="blog-main launcher">
        <div className="launcher-head">
          {space.logoUrl && (
            // biome-ignore lint/performance/noImgElement: 작은 로고 하나라 Next의 이미지 최적화를 거치지 않는다
            <img className="launcher-logo" src={space.logoUrl} alt="" />
          )}
          <h1>{space.name || 'Cairn'}</h1>
          {space.description && <p>{space.description}</p>}
        </div>
        {site.apps.length === 0 ? (
          <p className="blog-empty">공개한 앱 없음</p>
        ) : (
          <AppGrid apps={site.apps} />
        )}
      </main>
      <SiteFooter site={site} />
    </>
  );
}
