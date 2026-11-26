import { Icon } from '../_ui/Icon';
import { MoidaMark } from '../_ui/MoidaMark';
import { APPROVALS_HREF, CHAT_HREF, DOCK, SETTINGS_SECTION } from './menu';
import { NotificationBell } from './NotificationBell';

// 독 (2026-11-16 떠 있는 화면): 데스크톱은 왼쪽에 세로로, 폰은 아래에 가로로 떠 있다.
// 위는 보는 화면 여섯(대화 · 에이전트 · 스토어 · 오피스 · 승인 · 보관함), 아래 묶음은 알림 · 설정 (폰에서는 위쪽 줄 오른쪽).
// 메뉴는 일반 링크로 둔다: 글 편집기의 "저장 안 한 내용" 확인(beforeunload)이 페이지를 떠날 때 돌아야 한다.
export function ConsoleDock({
  here,
  pendingCount,
  siteName,
  logoUrl,
}: {
  /** 지금 화면 (menu.tsx placeOf의 section.key) */
  here: string;
  /** 기다리는 승인 수. 없으면 null */
  pendingCount: string | null;
  siteName: string;
  logoUrl: string | null;
}) {
  return (
    <nav className="dock" aria-label="화면">
      <a className="dock-brand" href={CHAT_HREF} title={siteName || 'Moida'}>
        {logoUrl ? (
          // biome-ignore lint/performance/noImgElement: 작은 로고 하나라 Next의 이미지 최적화를 거치지 않는다
          <img className="brand-logo" src={logoUrl} alt={siteName || 'Moida'} />
        ) : (
          <>
            <MoidaMark />
            <span className="sr">{siteName || 'Moida'}</span>
          </>
        )}
      </a>
      {DOCK.map((s) => (
        <a
          key={s.key}
          className="dock-item"
          href={s.href}
          aria-current={here === s.key ? 'page' : undefined}
        >
          <Icon name={s.icon} />
          <span className="dock-label">{s.name}</span>
          {s.href === APPROVALS_HREF && pendingCount && (
            <span className="dock-count">
              <span className="sr">대기 </span>
              {pendingCount}
              <span className="sr">건</span>
            </span>
          )}
        </a>
      ))}
      <div className="dock-extra">
        <NotificationBell />
        <a
          className="dock-item"
          href={SETTINGS_SECTION.href}
          aria-current={here === SETTINGS_SECTION.key ? 'page' : undefined}
        >
          <Icon name={SETTINGS_SECTION.icon} />
          <span className="dock-label">{SETTINGS_SECTION.name}</span>
        </a>
      </div>
    </nav>
  );
}
