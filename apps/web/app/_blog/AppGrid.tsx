import { AppIcon } from './AppIcon';
import { appPath } from './format';
import { APP_KIND_LABELS } from './labels';
import type { PublicApp } from './types';

// 앱 목록 (스토어 1-4, 공개 앱이 둘 이상일 때의 첫 화면): 휴대폰 홈 화면처럼 아이콘 · 이름 · 종류, 누르면 그 앱으로
export function AppGrid({ apps }: { apps: readonly PublicApp[] }) {
  return (
    <nav aria-label="앱">
      <ul className="app-grid">
        {apps.map((a) => (
          <li key={a.slug}>
            <a className="app-tile" href={appPath(a.slug)}>
              <AppIcon app={a} size="tile" />
              <span className="app-tile-name">{a.name}</span>
              <span className="app-tile-kind">{APP_KIND_LABELS[a.kind]}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
