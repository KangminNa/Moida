import { type MouseEvent, useEffect, useRef, useState } from 'react';

// 서버 브라우저 화면의 그림과 입력 (Screen.tsx가 쓴다).
// 그림을 누르면 그 자리를 클릭하고, 그다음 키보드로 치는 글자가 서버 브라우저로 간다 (보이지 않는 입력 칸이 받는다).
//   한글은 조합이 끝난 글자만 보내고, 붙여 넣기도 같은 길로 간다. 친 글자는 보내자마자 지워 이 화면에 남지 않는다 (비밀번호).
// 휠로 스크롤한다.

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
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

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

  /** 그림 위 누른 자리를 클릭하고, 키보드를 서버 브라우저로 돌린다 */
  function click(e: MouseEvent<HTMLButtonElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - box.left) / box.width;
    const fy = (e.clientY - box.top) / box.height;
    setMark({ x: fx * 100, y: fy * 100 });
    setRing(true);
    send({
      type: 'click',
      x: Math.max(0, Math.round(fx * shot.width)),
      y: Math.max(0, Math.round(fy * shot.height)),
    });
    keys.current?.focus({ preventScroll: true });
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
          onClick={click}
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
            if (e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
            if (!KEYS.has(e.key)) return;
            e.preventDefault();
            flush();
            send({ type: 'key', key: e.key });
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
