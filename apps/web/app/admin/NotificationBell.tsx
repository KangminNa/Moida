'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '../_lib/client-api';
import { useLiveValue } from '../_lib/use-live';
import type { Notification, NotificationList } from '../_platform/types';
import { Icon } from '../_ui/Icon';
import { useNotify } from '../_ui/notify';
import { Tick } from '../_ui/Tick';
import { BellPush } from './BellPush';

/** 알림이 남거나 읽히면 오는 변경 신호 */
const TOPICS = ['platform.notification'];

const when = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });

/** 알림 하나를 처음 본 것으로 기억하는 열쇠. 같은 묶음의 알림은 줄을 바꾸며 시각이 새로 된다 (Notices.post) */
const seenKey = (n: Notification) => `${n.id}@${n.createdAt}`;

// 독의 알림: 안 읽은 수와 최근 알림 (목록은 독 옆에 뜬다). 누르면 그 주소로 가고 읽음이 된다.
// 콘솔을 보고 있을 때 새 즉시 알림이 오면 아래 한 줄로도 알린다 (2026-11-27): 창을 닫았을 때는 브라우저 푸시가 맡는다.
// 무엇을 알리는지는 알리는 쪽(승인 요청, 작업 실패, 지울 만한 위키 등)이 정한다. 경로 · 조용한 시간은 설정 › 알림.
export function NotificationBell() {
  const router = useRouter();
  const list = useLiveValue(
    'notifications',
    () => api<NotificationList>('GET', '/api/notifications'),
    TOPICS,
  );
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const unread = list.data?.unread ?? 0;
  const notify = useNotify();
  const pathname = usePathname();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const items = list.data?.notifications;
    if (!items) return;
    // 처음 읽은 것은 알리지 않는다 (콘솔을 열 때마다 지난 알림이 쏟아지지 않게)
    const first = seen.current === null;
    const known = seen.current ?? new Set<string>();
    seen.current = known;
    const fresh = items.filter(
      (n) =>
        !first &&
        !n.read &&
        n.severity === 'immediate' &&
        !known.has(seenKey(n)) &&
        n.link !== pathname, // 지금 보고 있는 화면의 알림은 이미 보인다
    );
    for (const n of items) known.add(seenKey(n));
    if (fresh.length === 1) notify(`알림 · ${fresh[0]?.title}`);
    else if (fresh.length > 1) notify(`새 알림 ${fresh.length}개`);
  }, [list.data, notify, pathname]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    window.addEventListener('keydown', close);
    window.addEventListener('mousedown', close);
    return () => {
      window.removeEventListener('keydown', close);
      window.removeEventListener('mousedown', close);
    };
  }, [open]);

  async function go(notice: Notification) {
    if (!notice.read) await api('POST', '/api/notifications/read', { ids: [notice.id] });
    setOpen(false);
    await list.reload();
    if (notice.link) router.push(notice.link);
  }

  async function readAll() {
    await api('POST', '/api/notifications/read', {});
    await list.reload();
  }

  return (
    <div className="bell" ref={box}>
      <button
        type="button"
        className="dock-item bell-button"
        aria-expanded={open}
        aria-label={unread > 0 ? `알림, 안 읽음 ${unread}개` : '알림'}
        onClick={() => setOpen(!open)}
      >
        <Icon name="bell" />
        <span className="dock-label" aria-hidden="true">
          알림
        </span>
        {unread > 0 && (
          <span className="dock-count" aria-hidden="true">
            <Tick value={unread} />
          </span>
        )}
      </button>
      {open && (
        <section className="bell-panel" aria-label="알림 목록">
          <div className="row bell-head">
            <b>알림</b>
            {unread > 0 && (
              <button type="button" className="ghost" onClick={readAll}>
                모두 읽음
              </button>
            )}
          </div>
          <BellPush />
          {list.error && <p className="error">{list.error}</p>}
          {list.data && list.data.notifications.length === 0 ? (
            <p className="rows-empty">알림 없음</p>
          ) : (
            <ul className="list">
              {list.data?.notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={n.read ? 'item bell-item' : 'item bell-item unread'}
                    onClick={() => go(n)}
                  >
                    <div className="item-main">
                      <b>{n.title}</b>
                      {n.body && <small>{n.body}</small>}
                      <small>{when(n.createdAt)}</small>
                    </div>
                    {!n.read && (
                      <>
                        <span className="dot" aria-hidden="true" />
                        <span className="sr">안 읽음</span>
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
