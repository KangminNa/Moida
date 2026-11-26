'use client';

import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import type { SpaceInfo } from '../_account/types';
import type { PackageEntry } from '../_plugins/package-types';
import { useActivePackages } from '../_plugins/packages';
import { countOf, usePendingApprovals } from '../_task/live';
import { Icon } from '../_ui/Icon';
import { NotifyContext } from '../_ui/notify';
import { useToast } from '../_ui/useToast';
import { useWaitingChanges } from '../_vault/live';
import { ChatNav } from './ChatNav';
import { ConsoleDock } from './ConsoleDock';
import { ChatPanes } from './chats/ChatPanes';
import { NEW_CHAT, placeOf, SIDE_COOKIE } from './menu';
import { SectionTabs } from './SectionTabs';
import { ConsoleFoot, SettingsNav } from './SettingsNav';
import { SignedOutBar } from './SignedOutBar';
import { SiteAddressBar } from './SiteAddressBar';

/** 폰 화면 (globals.css의 좁은 화면과 같은 폭): 옆 칸이 접히는 대신 서랍으로 열린다 */
const PHONE = '(max-width: 760px)';

// 콘솔의 틀 (2026-11-16 떠 있는 화면): 떠 있는 독 + 옆 칸 + 남은 자리를 채우는 카드.
// 옆 칸은 화면에 따라 대화 목록(대화) · 설정 메뉴(설정)이고, 그 밖의 화면은 카드가 자리를 채운다.
// 데스크톱에서는 옆 칸을 접고 펴고(쿠키로 기억), 폰에서는 위쪽 줄의 단추로 서랍처럼 연다.
// 에이전트 · 보관함은 카드 위에 탭 줄. 독의 화면 사이를 오가면 카드가 위아래로 넘어간다 (page-flip.ts).
export function AdminShell({
  ownerName,
  siteName,
  logoUrl,
  space,
  activePlugins,
  sideClosed,
  children,
}: {
  /** 화면에 보일 이름 (정한 이름, 없으면 아이디) */
  ownerName: string;
  siteName: string;
  /** 사이트 로고. 없으면 Moida 표식 */
  logoUrl: string | null;
  /** 사이트 정보 (설정 › 사이트). 사이트 주소와 다른 주소로 열었으면 바꿀지 묻는다 */
  space: SpaceInfo | null;
  /** 서버에서 읽은 켜진 플러그인 이름. 메뉴를 처음부터 그 모양으로 그린다 */
  activePlugins: readonly string[];
  /** 옆 칸을 접어 두었는가 (쿠키, 서버에서 읽어 처음부터 그 모양으로) */
  sideClosed: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const packages = useActivePackages(activePlugins);
  const place = placeOf(pathname);
  const [drawer, setDrawer] = useState(false);
  const [closed, setClosed] = useState(sideClosed);
  const [toast, showToast] = useToast();
  const pending = usePendingApprovals();
  const proposals = useWaitingChanges();
  const toDecide = [...(pending.data?.approvals ?? []), ...(proposals.data?.changes ?? [])];
  const pendingCount = toDecide.length
    ? countOf(toDecide, pending.data?.next ?? proposals.data?.next)
    : null;
  const { section } = place;
  const chat = section.key === 'chat';

  useEffect(() => {
    if (!drawer) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawer(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [drawer]);

  /** 옆 칸 열기 · 닫기: 폰은 서랍, 데스크톱은 접기 (다음에 열 때도 그대로) */
  function showSide(open: boolean) {
    if (window.matchMedia(PHONE).matches) {
      setDrawer(open);
      return;
    }
    setClosed(!open);
    // biome-ignore lint/suspicious/noDocumentCookie: 서버가 첫 그림에 읽을 값이라 쿠키에 둔다 (Cookie Store API는 아직 모든 브라우저에 없다)
    document.cookie = `${SIDE_COOKIE}=${open ? 'open' : 'closed'}; path=/admin; max-age=31536000; samesite=lax`;
  }

  return (
    <NotifyContext.Provider value={showToast}>
      <div
        className={drawer ? 'console open' : 'console'}
        data-side={section.side ? (closed ? 'closed' : 'open') : 'none'}
      >
        <button
          type="button"
          className="console-scrim"
          aria-label="메뉴 닫기"
          onClick={() => setDrawer(false)}
        />
        <ConsoleDock
          here={section.key}
          pendingCount={pendingCount}
          siteName={siteName}
          logoUrl={logoUrl}
        />
        {section.side && (
          <aside className="console-side" aria-label={chat ? '대화 목록' : '설정 메뉴'}>
            <div className="side-head">
              {chat ? (
                <a className="chat-new" href={NEW_CHAT.href}>
                  <Icon name={NEW_CHAT.icon} />
                  {NEW_CHAT.name}
                </a>
              ) : (
                <b className="side-title">설정</b>
              )}
              <button
                type="button"
                className="icon-button"
                aria-label={chat ? '대화 목록 닫기' : '설정 메뉴 닫기'}
                onClick={() => showSide(false)}
              >
                <Icon name="back" />
              </button>
            </div>
            {chat ? (
              <ChatNav pathname={pathname} />
            ) : (
              <SettingsNav pathname={pathname} packages={packages} />
            )}
            {!chat && <ConsoleFoot ownerName={ownerName} />}
          </aside>
        )}
        <main className="console-work">
          {section.side && closed && (
            <button
              type="button"
              className="icon-button side-open"
              aria-label={chat ? '대화 목록 열기' : '설정 메뉴 열기'}
              onClick={() => showSide(true)}
            >
              <Icon name="panel" />
            </button>
          )}
          <header className="console-top">
            {section.side && (
              <button
                type="button"
                className="console-menu"
                aria-label={chat ? '대화 목록 열기' : '설정 메뉴 열기'}
                onClick={() => showSide(true)}
              >
                <Icon name="panel" />
              </button>
            )}
            <span className="console-title">
              <b>{titleOf(place, packages, pathname)}</b>
            </span>
          </header>
          {section.tabs && (
            <SectionTabs
              label={section.name}
              pages={section.pages}
              current={place.page?.href ?? null}
            />
          )}
          <div className="console-page">{chat ? <ChatPanes>{children}</ChatPanes> : children}</div>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      <SignedOutBar />
      <SiteAddressBar space={space} />
    </NotifyContext.Provider>
  );
}

/** 폰 위쪽 줄의 제목: 설정이면 그 메뉴 이름(기능 패키지 화면이면 패키지 이름), 아니면 화면 이름 */
function titleOf(
  place: ReturnType<typeof placeOf>,
  packages: readonly PackageEntry[],
  pathname: string | null,
): string {
  if (place.section.key !== 'settings') return place.section.name;
  const entry = packages.find((p) => pathname?.startsWith(`/admin/p/${p.plugin}`));
  return place.page?.name ?? entry?.name ?? place.section.name;
}
