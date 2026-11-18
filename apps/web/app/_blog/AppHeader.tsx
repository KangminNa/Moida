import { Icon } from '../_ui/Icon';
import { AppIcon } from './AppIcon';
import { appPath, menuPath } from './format';
import type { Site } from './site';
import type { PublicApp, PublicMenu } from './types';

// 앱 화면의 머리 (스토어 1-4): 왼쪽 끝 "모든 앱"(앱 목록으로, 공개 앱이 하나뿐이면 없다) · 앱 아이콘 · 앱 이름,
// 오른쪽에 그 앱의 메뉴 · 그래프(공개 글이 있을 때) · 로그인(관리자면 콘솔)
export function AppHeader({
  site,
  app,
  menus,
}: {
  site: Site;
  app: PublicApp;
  menus: readonly PublicMenu[];
}) {
  return (
    <header className="blog-top">
      <div className="app-brand">
        {site.apps.length > 1 && (
          <a className="app-all" href="/" aria-label="모든 앱" title="모든 앱">
            <Icon name="apps" />
          </a>
        )}
        <AppIcon app={app} size="small" />
        <a className="blog-brand" href={appPath(app.slug)}>
          {app.name}
        </a>
      </div>
      <nav aria-label={`${app.name} 메뉴`}>
        {menus.map((m) => (
          <a key={m.slug} href={menuPath(m.slug, app.slug)}>
            {m.name}
          </a>
        ))}
        {site.posts && <a href="/graph">그래프</a>}
        <a href={site.owner ? '/admin' : '/login'}>{site.owner ? '콘솔' : '로그인'}</a>
      </nav>
    </header>
  );
}
