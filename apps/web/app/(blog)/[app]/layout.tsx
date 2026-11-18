import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '../../_blog/AppShell';
import { appPath, slugFrom } from '../../_blog/format';
import { appIn, siteNow } from '../../_blog/site';

// 앱 하나의 화면들 (/<앱>/…, 스토어 1-4). 공개 앱만: 비공개 앱과 없는 앱은 같은 404 ("없는 페이지")라
// 앱이 있다는 사실도 드러나지 않는다 (원칙 5). 관리자가 열어도 방문자가 보는 그대로다 (글의 초안 미리 보기만 예외).
type Params = { params: Promise<{ app: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const site = await siteNow();
  const app = site ? appIn(site, slugFrom((await params).app)) : null;
  if (!site || !app) return {};
  const name = site.space.name || 'Cairn';
  return {
    title: `${app.name} · ${name}`,
    description: app.description || undefined,
    alternates:
      app.kind === 'page'
        ? undefined
        : { types: { 'application/rss+xml': `${appPath(app.slug)}/rss.xml` } },
  };
}

export default async function AppLayout({ children, params }: Params & { children: ReactNode }) {
  const site = await siteNow();
  if (!site)
    return (
      <main className="blog-main">
        <p className="blog-empty">서버에 연결하지 못했어요</p>
      </main>
    );
  const app = appIn(site, slugFrom((await params).app));
  if (!app) notFound();
  return (
    <AppShell site={site} app={app}>
      {children}
    </AppShell>
  );
}
