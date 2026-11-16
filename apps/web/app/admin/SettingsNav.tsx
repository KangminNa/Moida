import { api } from '../_lib/client-api';
import type { PackageEntry } from '../_plugins/package-types';
import { Icon } from '../_ui/Icon';
import { SOURCE_URL } from '../_ui/source';
import { ThemeToggle } from '../_ui/ThemeToggle';
import { MENU, PACKAGE_GROUPS } from './menu';
import { TextSize } from './TextSize';

/**
 * 설정 옆 칸의 메뉴: 설정 묶음, 접어 둔 "고급"(지금 화면이 그 안이면 펼친다).
 * 기능 패키지는 목록 파일의 묶음(옛 이름 포함, PACKAGE_GROUPS)에 붙고, 모르는 묶음은 고급의 맨 아래
 */
export function SettingsNav({
  pathname,
  packages,
}: {
  pathname: string | null;
  packages: readonly PackageEntry[];
}) {
  const groupOf = (p: PackageEntry) => PACKAGE_GROUPS[p.group] ?? '';
  const settings = MENU.filter((g) => !g.advanced);
  const advanced = MENU.filter((g) => g.advanced);
  const inAdvanced =
    advanced.some((g) => g.items.some((i) => pathname?.startsWith(i.href))) ||
    packages.some((p) => pathname?.startsWith(`/admin/p/${p.plugin}`));
  const loose = packages.filter((p) => !MENU.some((g) => g.label === groupOf(p)));
  const group = (g: (typeof MENU)[number]) => (
    <nav key={g.label} aria-label={g.label}>
      {g.advanced && <div className="console-label">{g.label}</div>}
      {g.items.map((item) => (
        <a
          key={item.href}
          className="console-link"
          href={item.href}
          aria-current={pathname?.startsWith(item.href) ? 'page' : undefined}
        >
          <Icon name={item.icon} />
          {item.name}
        </a>
      ))}
      {packages
        .filter((p) => groupOf(p) === g.label)
        .map((p) => (
          <PackageLink key={p.plugin} entry={p} pathname={pathname} />
        ))}
    </nav>
  );
  return (
    <>
      {settings.map(group)}
      <details className="console-more" open={inAdvanced || undefined}>
        <summary className="console-link">
          <Icon name="tools" />
          고급
        </summary>
        {advanced.map(group)}
        {loose.length > 0 && (
          <nav aria-label="기능 패키지">
            <div className="console-label">기능 패키지</div>
            {loose.map((p) => (
              <PackageLink key={p.plugin} entry={p} pathname={pathname} />
            ))}
          </nav>
        )}
      </details>
    </>
  );
}

/** 기능 패키지의 메뉴 한 줄 (목록 파일 menu). 화면은 /admin/p/<패키지> */
function PackageLink({ entry, pathname }: { entry: PackageEntry; pathname: string | null }) {
  const href = `/admin/p/${entry.plugin}`;
  return (
    <a
      className="console-link"
      href={href}
      aria-current={pathname?.startsWith(href) ? 'page' : undefined}
    >
      <Icon name={entry.icon} />
      {entry.name}
    </a>
  );
}

/** 설정 옆 칸의 아래: 나 · 화면 밝기 · 글자 크기 · 블로그 열기 · 로그아웃 · 소스 */
export function ConsoleFoot({ ownerName }: { ownerName: string }) {
  async function logout() {
    await api('POST', '/api/auth/logout');
    window.location.href = '/';
  }
  return (
    <div className="console-foot">
      <div className="console-me">
        <span className="avatar" aria-hidden="true">
          {ownerName.slice(0, 1)}
        </span>
        <span className="clamp-1">{ownerName}</span>
        <ThemeToggle />
      </div>
      <div className="console-me">
        <span className="console-me-label">글자</span>
        <TextSize />
      </div>
      <div className="console-foot-links">
        <a href="/">블로그 열기</a>
        <button type="button" onClick={logout}>
          로그아웃
        </button>
        <a href={SOURCE_URL} rel="noopener">
          소스 · AGPL-3.0
        </a>
      </div>
    </div>
  );
}
