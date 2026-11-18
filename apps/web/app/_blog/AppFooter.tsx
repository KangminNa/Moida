import { appPath } from './format';
import type { Site } from './site';
import type { PublicApp } from './types';

// 앱 화면의 아래쪽 (스토어 1-4): 다른 공개 앱 링크와 이 앱의 RSS (페이지 앱은 글이 없어 RSS가 없다)
export function AppFooter({ site, app }: { site: Site; app: PublicApp }) {
  const others = site.apps.filter((a) => a.slug !== app.slug);
  return (
    <footer className="blog-foot">
      {others.length > 0 && <span>다른 앱</span>}
      {others.map((a) => (
        <a key={a.slug} href={appPath(a.slug)}>
          {a.name}
        </a>
      ))}
      {app.kind !== 'page' && <a href={`${appPath(app.slug)}/rss.xml`}>RSS</a>}
    </footer>
  );
}
