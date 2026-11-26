import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { Call } from './browser-types';
import { ScreenPicture } from './ScreenPicture';
import { ScreenStatus } from './ScreenStatus';

// 서버 브라우저 화면 (2026-11-14): 영상 없이 HTTPS로 화면 그림을 받고, 클릭 · 글자 · 키를 보낸다.
// 그림은 서버가 탭에 붙어 받아 두는 흘려보내기(2026-11-26)에서 온다: "받은 마지막 번호(after)보다 새 그림"을 묻고,
// 답이 오면 바로 다시 묻는다. 화면이 바뀌는 만큼 그림이 오고, 그대로면 서버가 몇 초 기다렸다 그림 없이 답한다.
// 열려 있고 이 탭이 보일 때만 묻는다. 지금 상태를 한 줄로 보인다: 보는 중 · 멈춤(이 창이 가려짐) · 꺼짐(이유). 꺼져 있으면 10초마다만 다시 묻는다.
// 그림과 입력은 ScreenPicture.tsx. 보내기는 차례대로 한다: 빠르게 쳐도 순서가 섞이지 않는다.
//
// 두 자리에서 쓴다:
//   콘솔의 브라우저 화면 (pin 없음): 탭을 고르고 주소로 간다
//   승인 카드 (pin, 2026-11-17 대화에서 바로 로그인): 로그인하라고 열어 둔 탭(pin.url과 같은 사이트)에 묶인다.
//     탭 고르기 · 주소 칸은 없고, 페이지 전체를 카드 폭에 맞춰 보이며 "크게 보기"로 화면을 채운다

type Tab = { id: string; title: string; url: string };
/** 서버의 답: 새 그림이 없으면(화면 그대로) seq · image · 크기가 null */
type Reply = {
  tabs: Tab[];
  tab: string;
  seq: number | null;
  image: string | null;
  width: number | null;
  height: number | null;
};
type Shot = { tabs: Tab[]; tab: string; image: string; width: number; height: number };

/** 이 창이 가려져 있을 때 다시 볼 간격, 서버 브라우저에 닿지 않을 때 다시 물을 간격 */
const HIDDEN_MS = 1000;
/** 그림을 받은 뒤 다음 물음까지 가장 짧은 간격: 움직이는 페이지(영상 · 광고)에서 1초에 10장을 넘지 않게 */
const MIN_MS = 100;
const OFF_MS = 10_000;
/** 위 · 아래 버튼 한 번에 굴리는 양 (CSS 픽셀) */
const SCROLL = 400;

/** 묶을 탭: 주소가 같은 탭, 없으면 같은 사이트(호스트)의 탭. 없으면 null */
function pinnedTab(tabs: readonly Tab[], url: string): Tab | null {
  const host = (value: string) => {
    try {
      return new URL(value).host;
    } catch {
      return null;
    }
  };
  const wanted = host(url);
  return (
    tabs.find((t) => t.url === url) ??
    (wanted ? tabs.find((t) => host(t.url) === wanted) : undefined) ??
    null
  );
}

export function Screen({ call, pin }: { call: Call; pin?: { url: string } }) {
  const [open, setOpen] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // 이 창이 가려져 있는가 (그동안은 그리지 않는다)
  const [hidden, setHidden] = useState(false);
  const [url, setUrl] = useState('');
  // 카드: 화면을 가득 채워 보는 중인가, 묶을 탭을 찾지 못했는가
  const [large, setLarge] = useState(false);
  const [lost, setLost] = useState(false);
  // 고른 탭. 비우면 서버가 맨 앞 탭을 그린다
  const tab = useRef<string | null>(null);
  // 받은 마지막 그림의 번호 (탭을 바꾸면 0: 그 탭의 첫 그림부터)
  const seen = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pinUrl = pin?.url ?? null;

  const draw = useCallback(async () => {
    const read = () => {
      const query = new URLSearchParams({ after: String(seen.current) });
      if (tab.current) query.set('tab', tab.current);
      return call('GET', `screen?${query}`);
    };
    let reply = await read();
    if (!reply.ok) {
      setProblem(reply.message);
      return false;
    }
    let next = reply.data as Reply;
    if (pinUrl && tab.current === null) {
      // 처음 한 번: 로그인하라고 열어 둔 탭을 찾아 앞으로 가져온다. 못 찾으면 맨 앞 탭을 그대로 보인다
      const found = pinnedTab(next.tabs, pinUrl);
      setLost(found === null);
      if (found && found.id !== next.tab) {
        tab.current = found.id;
        seen.current = 0;
        await call('POST', 'screen/control', { tab: found.id, type: 'activate' });
        reply = await read();
        if (reply.ok) next = reply.data as Reply;
      }
    }
    if (next.tab !== tab.current) seen.current = 0;
    tab.current = next.tab;
    const { image, width, height, seq } = next;
    if (image !== null && width !== null && height !== null && seq !== null) {
      seen.current = seq;
      setShot({ tabs: next.tabs, tab: next.tab, image, width, height });
    } else setShot((now) => (now ? { ...now, tabs: next.tabs, tab: next.tab } : now));
    setProblem(null);
    return true;
  }, [call, pinUrl]);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 답을 받자마자 다시 묻는다 (서버가 새 그림이 올 때까지 잡고 있다). 가려져 있으면 쉬고, 닿지 않으면 길게 쉰다
    const loop = async () => {
      setHidden(document.hidden);
      if (document.hidden) {
        if (!stopped) timer = setTimeout(loop, HIDDEN_MS);
        return;
      }
      const reached = await draw();
      if (!stopped) timer = setTimeout(loop, reached ? MIN_MS : OFF_MS);
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [open, draw]);

  // 크게 보는 중에는 Esc로 작게
  useEffect(() => {
    if (!large) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLTextAreaElement)) setLarge(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [large]);

  /** 동작을 차례대로 보낸다. 바뀐 화면은 흘려보내기로 곧 온다 */
  const send = useCallback(
    (body: Record<string, unknown>) => {
      queue.current = queue.current.then(async () => {
        if (!tab.current) return;
        const reply = await call('POST', 'screen/control', { tab: tab.current, ...body });
        if (!reply.ok) setProblem(reply.message);
      });
    },
    [call],
  );

  function go(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    send({ type: 'navigate', url: url.trim() });
  }

  function pick(id: string) {
    tab.current = id;
    seen.current = 0;
    send({ type: 'activate' });
  }

  function scrollBy(dy: number) {
    if (!shot) return;
    send({ type: 'scroll', x: Math.round(shot.width / 2), y: Math.round(shot.height / 2), dy });
  }

  function toggle() {
    if (open) setLarge(false);
    setOpen(!open);
  }

  const moves = (
    <>
      <button type="button" className="ghost" onClick={() => send({ type: 'back' })}>
        뒤로
      </button>
      <button type="button" className="ghost" onClick={() => scrollBy(-SCROLL)}>
        위로
      </button>
      <button type="button" className="ghost" onClick={() => scrollBy(SCROLL)}>
        아래로
      </button>
    </>
  );
  const status = open && (
    <ScreenStatus problem={problem} hidden={hidden} retry={() => void draw()} />
  );
  const toggler = (
    <button type="button" className="cta small fit" onClick={toggle}>
      {open ? '화면 닫기' : '화면 열기'}
    </button>
  );

  if (pin)
    return (
      <div className={large ? 'screen-embed large' : 'screen-embed'}>
        {status}
        {open && lost && <p className="note">열어 둔 탭을 찾지 못해 맨 앞 탭을 보여요</p>}
        {open && shot && (
          <>
            <div className="row">
              {moves}
              <button type="button" className="ghost" onClick={() => setLarge(!large)}>
                {large ? '작게 보기' : '크게 보기'}
              </button>
            </div>
            <ScreenPicture shot={shot} send={send} />
          </>
        )}
        {toggler}
      </div>
    );

  return (
    <section className="panel" aria-label="브라우저 화면">
      <b>화면</b>
      <p className="note">
        화면을 누르면 그 자리를 클릭하고, 이어서 키보드로 치면 서버 브라우저에 들어가요 (한글 · 붙여
        넣기 · Enter · Tab 포함). 휠로 스크롤해요. 사이트 로그인과, 승인된 클릭이 바뀌어 누르지 못한
        것은 여기서 직접 해요
      </p>
      {status}
      {open && shot && (
        <>
          <div className="row">
            <label className="field">
              <span>탭</span>
              <select className="input" value={shot.tab} onChange={(e) => pick(e.target.value)}>
                {shot.tabs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title || t.url}
                  </option>
                ))}
              </select>
            </label>
            {moves}
          </div>
          <ScreenPicture shot={shot} send={send} />
          <form className="row" onSubmit={go}>
            <label className="field">
              <span>주소로 가기</span>
              <input
                className="input"
                type="url"
                placeholder="https://"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <button type="submit" className="ghost">
              가기
            </button>
          </form>
        </>
      )}
      {toggler}
    </section>
  );
}
