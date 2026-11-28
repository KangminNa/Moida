'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Icon } from '../../_ui/Icon';
import { CHATS_HREF } from '../menu';
import { ChatThreadPanel } from './ChatThreadPanel';
import { CHAT_DRAG, clampRatio, mainChatOf, SIDE_RATIO, sideChatOf, withSide } from './chat-panes';

/** 옆 칸 너비를 이 브라우저에 기억하는 이름 (없거나 읽지 못하면 반반) */
const RATIO_KEY = 'moida.chat-side-ratio';

// 대화 화면 나누기 (2026-11-25 사용자 요청): 대화 목록의 대화를 끌어 이 자리에 놓으면 오른쪽에 그 대화가 열린다.
// 옆 대화는 주소의 ?side=<id>라 새로고침 · 뒤로 가기가 된다. 가운데 줄을 끌거나(키보드는 ← →) 너비를 바꾸고,
// 옆 칸의 단추로 크게 보기(그 대화를 왼쪽으로) · 닫기. 폰 폭에서는 옆 칸을 그리지 않는다 (globals.css)
export function ChatPanes({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? CHATS_HREF;
  const router = useRouter();
  const side = sideChatOf(useSearchParams().get('side'), mainChatOf(pathname));
  const box = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const [ratio, setRatio] = useState<number>(SIDE_RATIO.initial);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(RATIO_KEY);
      if (saved !== null) setRatio(clampRatio(Number(saved)));
    } catch {
      // 저장소를 쓸 수 없는 창: 반반으로 둔다
    }
  }, []);

  const keep = (next: number) => {
    setRatio(next);
    try {
      window.localStorage.setItem(RATIO_KEY, String(next));
    } catch {
      // 기억하지 못해도 지금 화면은 그대로
    }
  };

  const open = (id: string) => {
    if (sideChatOf(id, mainChatOf(pathname)) !== null) router.push(withSide(pathname, id));
  };
  const close = () => router.replace(withSide(pathname, null));

  const dragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(CHAT_DRAG)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setOver(true);
  };
  const dragLeave = (e: DragEvent) => {
    if (!box.current?.contains(e.relatedTarget as Node | null)) setOver(false);
  };
  const drop = (e: DragEvent) => {
    setOver(false);
    const id = e.dataTransfer.getData(CHAT_DRAG);
    if (!id) return;
    e.preventDefault();
    open(id);
  };

  /** 가운데 줄 끌기: 누른 채로 움직이는 동안 옆 칸의 몫을 바꾸고, 놓으면 기억한다 */
  const resize = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (rect && rect.width > 0) setRatio(clampRatio((rect.right - clientX) / rect.width));
  };
  const nudge = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowLeft' ? 0.05 : e.key === 'ArrowRight' ? -0.05 : 0;
    if (step === 0) return;
    e.preventDefault();
    keep(clampRatio(ratio + step));
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 끌어 놓는 자리일 뿐이다. 키보드로는 대화 목록의 "옆에 열기" 단추로 같은 일을 한다
    <div
      ref={box}
      className="chat-panes"
      data-split={side ? 'on' : 'off'}
      onDragOver={dragOver}
      onDragLeave={dragLeave}
      onDrop={drop}
    >
      <div className="chat-pane">{children}</div>
      {side && (
        <>
          {/* biome-ignore lint/a11y/useSemanticElements: 끌 수 있는 세로 구분선이라 hr이 아니라 separator 역할의 div다 */}
          <div
            className="chat-pane-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="옆 대화 너비 (← → 로 바꾸기)"
            aria-valuemin={SIDE_RATIO.min * 100}
            aria-valuemax={SIDE_RATIO.max * 100}
            aria-valuenow={Math.round(ratio * 100)}
            tabIndex={0}
            onKeyDown={nudge}
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) resize(e.clientX);
            }}
            onPointerUp={() => keep(ratio)}
          />
          <section
            className="chat-pane side"
            aria-label="옆 대화"
            style={{ flexBasis: `${ratio * 100}%` }}
          >
            <div className="chat-pane-bar">
              <Link className="ghost" href={`${CHATS_HREF}/${side}`}>
                크게 보기
              </Link>
              <button
                type="button"
                className="icon-button"
                aria-label="옆 대화 닫기"
                onClick={close}
              >
                <Icon name="x" />
              </button>
            </div>
            <ChatThreadPanel key={side} id={side} onGone={close} />
          </section>
        </>
      )}
      {over && (
        <div className="chat-drop" aria-hidden="true">
          여기에 놓으면 옆에 열려요
        </div>
      )}
    </div>
  );
}
