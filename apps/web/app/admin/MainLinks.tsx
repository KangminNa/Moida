import { APPROVALS_HREF, MAIN_MENU, MenuIcon, SETTINGS_HREF } from './menu';

// 왼쪽 칸에 늘 보이는 네 줄 (2026-11-15 화면 정리). 대화 칸(ChatNav)에서는 목록 아래, 설정 칸(AdminShell)에서는 맨 위.
/** 늘 보이는 네 줄 (승인 · 팀 · 보관함 · 설정). 승인에는 기다리는 수 */
export function MainLinks({
  pathname,
  pendingCount,
  settingsOpen,
}: {
  pathname: string | null;
  pendingCount: string | null;
  /** 설정 칸에 있는가 (설정 줄을 지금 자리로 표시) */
  settingsOpen: boolean;
}) {
  return (
    <>
      {MAIN_MENU.map((item) => {
        const here =
          item.href === SETTINGS_HREF ? settingsOpen : (pathname?.startsWith(item.href) ?? false);
        return (
          <a
            key={item.href}
            className="console-link"
            href={item.href}
            aria-current={here ? 'page' : undefined}
          >
            <MenuIcon name={item.icon} />
            {item.name}
            {item.href === APPROVALS_HREF && pendingCount && (
              <span className="console-count">
                <span className="sr">대기 </span>
                {pendingCount}
                <span className="sr">건</span>
              </span>
            )}
          </a>
        );
      })}
    </>
  );
}
