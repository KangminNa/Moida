'use client';

import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { api } from '../_lib/client-api';
import type { PackageEntry } from '../_plugins/package-types';
import { useActivePackages } from '../_plugins/packages';
import { countOf, usePendingApprovals } from '../_task/live';
import { CairnMark } from '../_ui/CairnMark';
import { NotifyContext } from '../_ui/notify';
import { SOURCE_URL } from '../_ui/source';
import { ThemeToggle } from '../_ui/ThemeToggle';
import { useToast } from '../_ui/useToast';
import { useWaitingChanges } from '../_vault/live';
import { ChatNav } from './ChatNav';
import { MainLinks } from './MainLinks';
import { CHAT_HREF, CHATS_HREF, MENU, MenuIcon, PACKAGE_GROUPS, titleOf } from './menu';
import { NotificationBell } from './NotificationBell';

/** 대화 칸인가 (새 대화 · 대화 하나): 왼쪽이 대화 목록이 된다 */
function isChat(pathname: string | null): boolean {
  return pathname === CHAT_HREF || (pathname?.startsWith(`${CHATS_HREF}/`) ?? false);
}

// 콘솔의 틀: 왼쪽 칸 + 작업 칸. 좁은 화면에서는 왼쪽 칸이 서랍으로 열린다.
// 2차 1-5: 대화 칸에서는 왼쪽이 대화 목록(ChatNav, 아래에 승인 · 팀 · 보관함 · 설정), 그 밖(설정)에서는 메뉴와 "대화로 돌아가기".
// 위쪽 줄은 지금 화면의 이름(설정 › 이름)과 알림 종, 아래 프로필 줄에 화면 밝기 · 블로그 열기 · 로그아웃 (2026-11-15 화면 정리).
// 메뉴는 일반 링크로 둔다: 글 편집기의 "저장 안 한 내용" 확인(beforeunload)이 페이지를 떠날 때 돌아야 한다.
export function AdminShell({
  ownerName,
  siteName,
  logoUrl,
  activePlugins,
  children,
}: {
  /** 화면에 보일 이름 (정한 이름, 없으면 아이디) */
  ownerName: string;
  siteName: string;
  /** 사이트 로고. 없으면 Cairn 표시 */
  logoUrl: string | null;
  /** 서버에서 읽은 켜진 플러그인 이름. 메뉴를 처음부터 그 모양으로 그린다 */
  activePlugins: readonly string[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const packages = useActivePackages(activePlugins);
  const [open, setOpen] = useState(false);
  const [toast, showToast] = useToast();
  const pending = usePendingApprovals();
  const proposals = useWaitingChanges();
  const toDecide = [...(pending.data?.approvals ?? []), ...(proposals.data?.changes ?? [])];
  const pendingCount = toDecide.length
    ? countOf(toDecide, pending.data?.next ?? proposals.data?.next)
    : null;

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  async function logout() {
    await api('POST', '/api/auth/logout');
    window.location.href = '/';
  }

  return (
    <NotifyContext.Provider value={showToast}>
      <div className={open ? 'console open' : 'console'}>
        <button
          type="button"
          className="console-scrim"
          aria-label="메뉴 닫기"
          onClick={() => setOpen(false)}
        />
        <aside className="console-side" aria-label="콘솔 메뉴">
          <a className="console-brand" href="/admin">
            {logoUrl ? (
              // biome-ignore lint/performance/noImgElement: 작은 로고 하나라 Next의 이미지 최적화를 거치지 않는다
              <img className="brand-logo" src={logoUrl} alt="" />
            ) : (
              <CairnMark />
            )}
            {siteName || 'Cairn'}
          </a>
          {isChat(pathname) ? (
            <ChatNav pathname={pathname} pendingCount={pendingCount} />
          ) : (
            <SettingsNav pathname={pathname} packages={packages} pendingCount={pendingCount} />
          )}
          <div className="console-foot">
            <div className="console-me">
              <span className="avatar" aria-hidden="true">
                {ownerName.slice(0, 1)}
              </span>
              <span className="clamp-1">{ownerName}</span>
              <ThemeToggle />
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
        </aside>
        <div className="console-work">
          <header className="console-top">
            <button
              type="button"
              className="console-menu"
              aria-label="메뉴 열기"
              onClick={() => setOpen(true)}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
              </svg>
            </button>
            <PageTitle pathname={pathname} packages={packages} />
            <NotificationBell />
          </header>
          <div className="console-page">{children}</div>
        </div>
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </NotifyContext.Provider>
  );
}

/** 위쪽 줄의 제목: 설정 › 이름. 기능 패키지 화면이면 그 메뉴 이름 */
function PageTitle({
  pathname,
  packages,
}: {
  pathname: string | null;
  packages: readonly PackageEntry[];
}) {
  const found =
    titleOf(pathname) ??
    (() => {
      const entry = packages.find((p) => pathname?.startsWith(`/admin/p/${p.plugin}`));
      return entry ? { section: '설정', name: entry.name } : null;
    })();
  if (!found) return <span className="console-title" />;
  return (
    <span className="console-title">
      {found.section && <span className="crumb">{found.section} › </span>}
      <b>{found.name}</b>
    </span>
  );
}

/**
 * 설정 칸의 왼쪽: 대화로 돌아가는 줄, 네 줄, 설정 묶음, 접어 둔 "고급"(지금 화면이 그 안이면 펼친다).
 * 기능 패키지는 목록 파일의 묶음(옛 이름 포함, PACKAGE_GROUPS)에 붙고, 모르는 묶음은 고급의 맨 아래
 */
function SettingsNav({
  pathname,
  packages,
  pendingCount,
}: {
  pathname: string | null;
  packages: readonly PackageEntry[];
  pendingCount: string | null;
}) {
  const groupOf = (p: PackageEntry) => PACKAGE_GROUPS[p.group] ?? '';
  const settings = MENU.filter((g) => !g.advanced);
  const advanced = MENU.filter((g) => g.advanced);
  const inSettings = settings.some((g) => g.items.some((i) => pathname?.startsWith(i.href)));
  const inAdvanced =
    advanced.some((g) => g.items.some((i) => pathname?.startsWith(i.href))) ||
    packages.some((p) => pathname?.startsWith(`/admin/p/${p.plugin}`));
  const loose = packages.filter((p) => !MENU.some((g) => g.label === groupOf(p)));
  const group = (g: (typeof MENU)[number]) => (
    <nav key={g.label} aria-label={g.label}>
      <div className="console-label">{g.label}</div>
      {g.items.map((item) => (
        <a
          key={item.href}
          className="console-link"
          href={item.href}
          aria-current={pathname?.startsWith(item.href) ? 'page' : undefined}
        >
          <MenuIcon name={item.icon} />
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
      <a className="console-link chat-back" href={CHAT_HREF}>
        <MenuIcon name="back" />
        대화로 돌아가기
      </a>
      <nav aria-label="주요">
        <MainLinks pathname={pathname} pendingCount={pendingCount} settingsOpen={inSettings} />
      </nav>
      {settings.map(group)}
      <details className="console-more" open={inAdvanced || undefined}>
        <summary className="console-link">
          <MenuIcon name="tools" />
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
      <MenuIcon name={entry.icon} />
      {entry.name}
    </a>
  );
}
