import type { ReactNode } from 'react';
import { serverGet } from '../_lib/server-api';
import { AppFooter } from './AppFooter';
import { AppHeader } from './AppHeader';
import type { Site } from './site';
import type { PublicApp, PublicMenuList } from './types';

// 앱 하나의 틀 (스토어 1-4): 머리(그 앱의 메뉴) · 본문 · 아래쪽. /<앱>/… 과, 공개 앱이 하나뿐일 때의 첫 화면(/)이 쓴다
export async function AppShell({
  site,
  app,
  children,
}: {
  site: Site;
  app: PublicApp;
  children: ReactNode;
}) {
  const menus = await serverGet<PublicMenuList>(
    `/api/menus?app=${encodeURIComponent(app.slug)}`,
    true,
  );
  return (
    <>
      <AppHeader site={site} app={app} menus={menus?.menus ?? []} />
      {children}
      <AppFooter site={site} app={app} />
    </>
  );
}
