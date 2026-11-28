import { type FormEvent, type ReactNode, useEffect, useState } from 'react';

// 서버 브라우저 화면의 머리 줄 (2026-11-28 브라우저처럼): 뒤로 · 앞으로 · 새로고침, 지금 주소가 보이는 주소 칸, 새 탭 · 탭 닫기.
// 주소 칸은 고치는 동안만 내 글이고, 그 밖에는 지금 탭의 주소를 따라간다. 주소가 아닌 말을 치면 검색으로 연다.
// 승인 카드(pin)에서는 주소 칸 · 탭 버튼 없이 이동 버튼만 (로그인하라고 열어 둔 탭에 묶여 있다)

type Send = (body: Record<string, unknown>) => void;

/** 친 글을 열 주소로: http(s)면 그대로, 점이 있고 띄어쓰기가 없으면 https://를 붙이고, 아니면 검색 */
export function addressOf(text: string): string {
  const typed = text.trim();
  if (/^https?:\/\//i.test(typed)) return typed;
  if (/^[^\s/]+\.[^\s]+$/.test(typed)) return `https://${typed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(typed)}`;
}

export function ScreenBar({
  send,
  current,
  scroll,
  openTab,
  closeTab,
  extra,
}: {
  send: Send;
  /** 지금 탭의 주소. 없으면(승인 카드) 주소 칸 · 탭 버튼을 그리지 않는다 */
  current?: string;
  /** 위로(-1) · 아래로(1) 한 화면쯤 */
  scroll: (way: -1 | 1) => void;
  openTab?: (url: string | null) => void;
  closeTab?: () => void;
  /** 줄 끝에 더 놓을 것 (크게 보기) */
  extra?: ReactNode;
}) {
  const [text, setText] = useState(current ?? '');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(current ?? '');
  }, [current, editing]);

  function go(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    send({ type: 'navigate', url: addressOf(text) });
    setEditing(false);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  const button = (label: string, title: string, run: () => void) => (
    <button type="button" className="ghost" title={title} aria-label={title} onClick={run}>
      {label}
    </button>
  );

  return (
    <form className="row" onSubmit={go} style={{ alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {button('뒤로', '뒤로 (Alt+←)', () => send({ type: 'back' }))}
      {button('앞으로', '앞으로 (Alt+→)', () => send({ type: 'forward' }))}
      {button('새로고침', '새로고침 (Ctrl+R · F5)', () => send({ type: 'reload' }))}
      {current !== undefined && (
        <input
          className="input"
          aria-label="주소"
          placeholder="주소나 검색어"
          value={text}
          onFocus={(e) => {
            setEditing(true);
            e.currentTarget.select();
          }}
          onBlur={() => setEditing(false)}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setEditing(false);
              e.currentTarget.blur();
            }
          }}
          style={{ flex: '1 1 220px', minWidth: 0 }}
        />
      )}
      {openTab && button('새 탭', '새 탭', () => openTab(null))}
      {closeTab && button('탭 닫기', '이 탭 닫기', closeTab)}
      {button('위로', '위로', () => scroll(-1))}
      {button('아래로', '아래로', () => scroll(1))}
      {extra}
    </form>
  );
}
