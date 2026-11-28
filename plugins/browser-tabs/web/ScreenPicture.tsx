import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react';

// 서버 브라우저 화면의 그림과 입력 (Screen.tsx가 쓴다).
// 그림을 누르면 그 자리를 클릭하고, 그다음 키보드로 치는 글자가 서버 브라우저로 간다 (보이지 않는 입력 칸이 받는다).
//   한글은 조합이 끝난 글자만 보내고, 붙여 넣기도 같은 길로 간다. 친 글자는 보내자마자 지워 이 화면에 남지 않는다 (비밀번호).
// 휠로 스크롤한다. 누른 채 움직이면 끌기(슬라이더 · 지도 · 글자 고르기), 빨리 두 번 누르면 더블클릭,
// 누르지 않고 멈추면 그 자리에 마우스를 올린다(올리면 열리는 메뉴) (2026-11-28 브라우저처럼).
// 단축키: Alt+← · → 뒤로 · 앞으로, Ctrl · Cmd+R · F5 새로고침, Ctrl · Cmd+A · C · X · Z는 서버 브라우저에서
// (붙여 넣기 Ctrl+V는 이 컴퓨터의 클립보드를 글자로 보낸다).

export type ScreenShot = { image: string; width: number; height: number };
export type ScreenSend = (body: Record<string, unknown>) => void;

/** 누른 자리 동그라미가 보이는 시간 */
const RING_MS = 1200;
/** 휠을 모아 보내는 간격 */
const WHEEL_MS = 120;
/** 글자가 아니라 키로 보내는 것 (서버의 BrowserScreenGateway.KEY_NAMES와 같게) */
const KEYS = new Set([
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'Escape',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);
/** Ctrl · Cmd와 함께 서버 브라우저로 보내는 글자 키 (v는 빼고: 이 컴퓨터의 붙여 넣기가 글자로 간다) */
const COMMAND_KEYS = new Set(['a', 'c', 'x', 'z']);
/** 이만큼(px) 움직이면 클릭이 아니라 끌기 */
const DRAG_PX = 6;
/** 끄는 동안 움직임을 보내는 간격, 누르지 않고 멈춘 뒤 마우스를 올리기까지 */
const MOVE_MS = 50;
const HOVER_MS = 250;
/** 이 안에 같은 자리를 다시 누르면 더블클릭 */
const DOUBLE_MS = 400;

/** 조합 키를 CDP의 수로 (Alt 1 · Ctrl 2 · Meta 4 · Shift 8) */
function modsOf(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

export function ScreenPicture({ shot, send }: { shot: ScreenShot; send: ScreenSend }) {
  // 키보드가 서버 브라우저로 가는 중인가
  const [typing, setTyping] = useState(false);
  // 마지막으로 누른 자리 (그림 대비 %). 입력 칸이 이 자리에 있고(폰 키보드가 이 근처를 보게), 동그라미는 잠깐만 보인다
  const [mark, setMark] = useState<{ x: number; y: number } | null>(null);
  const [ring, setRing] = useState(false);
  const keys = useRef<HTMLTextAreaElement>(null);
  const picture = useRef<HTMLButtonElement>(null);

  // 누른 자리 동그라미는 잠깐만
  useEffect(() => {
    if (!ring) return;
    const timer = setTimeout(() => setRing(false), RING_MS);
    return () => clearTimeout(timer);
  }, [ring]);

  // 휠: 화면 그림 위에서 굴리면 서버 브라우저가 스크롤된다 (콘솔 쪽은 움직이지 않게 passive가 아닌 듣기로)
  useEffect(() => {
    const target = picture.current;
    if (!target) return;
    let dy = 0;
    let at = { x: 0, y: 0 };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = target.getBoundingClientRect();
      at = {
        x: Math.round(((e.clientX - box.left) / box.width) * shot.width),
        y: Math.round(((e.clientY - box.top) / box.height) * shot.height),
      };
      dy += e.deltaY;
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        const amount = Math.max(-5000, Math.min(5000, Math.round(dy)));
        dy = 0;
        if (amount !== 0)
          send({ type: 'scroll', x: Math.max(0, at.x), y: Math.max(0, at.y), dy: amount });
      }, WHEEL_MS);
    };
    target.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      target.removeEventListener('wheel', onWheel);
      clearTimeout(timer);
    };
  }, [shot.width, shot.height, send]);

  // 누르고 있는 자리 · 끄는 중인가 · 마지막 클릭 (더블클릭) · 움직임 타이머
  const held = useRef<{ x: number; y: number; px: number; py: number; dragging: boolean } | null>(
    null,
  );
  const lastClick = useRef<{ at: number; x: number; y: number } | null>(null);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(moveTimer.current), []);

  /** 화면 위 자리 → 그림 대비 비율과 서버 브라우저의 좌표 */
  function pointOf(e: PointerEvent<HTMLButtonElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    const fy = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
    return { fx, fy, x: Math.round(fx * shot.width), y: Math.round(fy * shot.height) };
  }

  function down(e: PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    clearTimeout(moveTimer.current);
    const at = pointOf(e);
    held.current = { x: at.x, y: at.y, px: e.clientX, py: e.clientY, dragging: false };
  }

  function move(e: PointerEvent<HTMLButtonElement>) {
    const at = pointOf(e);
    const hold = held.current;
    if (!hold) {
      // 누르지 않고 멈추면 그 자리에 마우스를 올린다 (마우스만, 손가락은 아님)
      if (e.pointerType !== 'mouse') return;
      clearTimeout(moveTimer.current);
      moveTimer.current = setTimeout(() => send({ type: 'hover', x: at.x, y: at.y }), HOVER_MS);
      return;
    }
    if (!hold.dragging) {
      if (Math.hypot(e.clientX - hold.px, e.clientY - hold.py) < DRAG_PX) return;
      hold.dragging = true;
      send({ type: 'press', x: hold.x, y: hold.y });
    }
    if (moveTimer.current) return;
    moveTimer.current = setTimeout(() => {
      moveTimer.current = undefined;
      send({ type: 'move', x: at.x, y: at.y });
    }, MOVE_MS);
  }

  /** 떼면: 끌었으면 그 자리에서 놓고, 아니면 클릭(같은 자리를 빨리 다시 누르면 더블클릭). 키보드를 서버 브라우저로 */
  function up(e: PointerEvent<HTMLButtonElement>) {
    const hold = held.current;
    held.current = null;
    if (!hold) return;
    const at = pointOf(e);
    clearTimeout(moveTimer.current);
    moveTimer.current = undefined;
    if (hold.dragging) send({ type: 'release', x: at.x, y: at.y });
    else {
      const now = Date.now();
      const last = lastClick.current;
      const double =
        last !== null && now - last.at < DOUBLE_MS && Math.hypot(at.x - last.x, at.y - last.y) < 8;
      // 더블클릭은 클릭 한 번을 이미 보냈으니 두 번째 누름만(clickCount 2) 더한다
      send({ type: 'click', x: at.x, y: at.y, ...(double ? { count: 2 } : {}) });
      lastClick.current = double ? null : { at: now, x: at.x, y: at.y };
    }
    setMark({ x: at.fx * 100, y: at.fy * 100 });
    setRing(true);
    keys.current?.focus({ preventScroll: true });
  }

  /** 단축키 · 키. 처리했으면 true (보이지 않는 입력 칸에 글자로 들어가지 않게) */
  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
    const command = e.ctrlKey || e.metaKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (e.altKey && (key === 'ArrowLeft' || key === 'ArrowRight'))
      send({ type: key === 'ArrowLeft' ? 'back' : 'forward' });
    else if (key === 'F5' || (command && key === 'r')) send({ type: 'reload' });
    else if (command && COMMAND_KEYS.has(key)) send({ type: 'key', key, mods: modsOf(e) });
    else if (KEYS.has(key) && !command && !e.altKey) {
      flush();
      send({ type: 'key', key, mods: modsOf(e) });
    } else return false;
    return true;
  }

  /** 보이지 않는 입력 칸에 쌓인 글자를 보내고 비운다 */
  function flush() {
    const box = keys.current;
    if (!box?.value) return;
    const text = box.value;
    box.value = '';
    send({ type: 'text', text });
  }

  return (
    <>
      <div
        style={{
          position: 'relative',
          outline: typing ? '2px solid currentColor' : '1px solid transparent',
          outlineOffset: 2,
        }}
      >
        <button
          ref={picture}
          type="button"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={() => {
            held.current = null;
          }}
          aria-label="서버 브라우저 화면. 누른 자리를 클릭하고 이어서 키보드로 입력해요"
          style={{
            display: 'block',
            width: '100%',
            padding: 0,
            border: 0,
            background: 'none',
            cursor: 'crosshair',
          }}
        >
          <img
            src={`data:image/jpeg;base64,${shot.image}`}
            alt=""
            draggable={false}
            style={{ display: 'block', width: '100%', height: 'auto' }}
          />
        </button>
        {mark && ring && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: `${mark.x}%`,
              top: `${mark.y}%`,
              width: 18,
              height: 18,
              marginLeft: -9,
              marginTop: -9,
              border: '2px solid currentColor',
              borderRadius: '50%',
              pointerEvents: 'none',
            }}
          />
        )}
        <textarea
          ref={keys}
          aria-label="서버 브라우저에 입력"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (keyDown(e)) e.preventDefault();
          }}
          onInput={(e) => {
            // 한글 조합 중에는 기다렸다가 조합이 끝난 글자만 보낸다
            if (!(e.nativeEvent as InputEvent).isComposing) flush();
          }}
          onCompositionEnd={() => setTimeout(flush, 0)}
          style={{
            position: 'absolute',
            left: mark ? `${mark.x}%` : 0,
            top: mark ? `${mark.y}%` : 0,
            width: 1,
            height: 1,
            padding: 0,
            border: 0,
            opacity: 0,
            resize: 'none',
            overflow: 'hidden',
          }}
        />
      </div>
      {typing && <p className="note">키보드가 서버 브라우저로 가요 · 화면 밖을 누르면 멈춰요</p>}
    </>
  );
}
