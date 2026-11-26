import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SiteFooter } from '../_blog/SiteFooter';
import { StoreHome } from '../_blog/StoreHome';
import { siteNow } from '../_blog/site';

// 첫 화면 (스토어 1-4, 시안 6 · 7 · 8번): 관리자가 공개 앱 하나로 고정했으면 그 앱으로(스토어 2단계, 설정 › 사이트 "첫 화면"),
// 아니면 자동: 공개 앱이 1개면 그 앱의 주소로 보내고(스토어 1-6: 앱 화면은 앱 코드가 그린다), 0개 · 2개 이상이면 스토어 첫 화면
// (2026-11-26, _blog/StoreHome). 스토어 첫 화면은 고정 · 앱 하나와 상관없이 /store에서도 열린다. 관리자가 열어도 방문자가 보는 그대로다.
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

type Search = { sheet?: string; session?: string; error?: string };

export async function generateMetadata(): Promise<Metadata> {
  const site = await siteNow();
  return { title: site?.space.name || 'Moida', description: site?.space.description };
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
  // 고정한 앱(스토어 2단계)이나 하나뿐인 공개 앱이면 그 앱의 주소로 (307): 앱 화면은 앱 코드가 그린다 (스토어 1-6)
  const pinned = site.apps.find((a) => a.home);
  if (pinned) redirect(pinned.url);
  const [only] = site.apps;
  if (only && site.apps.length === 1) redirect(only.url);
  return (
    <>
      <StoreHome site={site} mail={{ mail: null, token: null }} />
      <SiteFooter site={site} />
    </>
  );
}
