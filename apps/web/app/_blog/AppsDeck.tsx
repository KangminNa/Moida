'use client';

import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import './apps-deck.css';
import { AppArt } from './AppArt';
import type { PublicApp } from './types';

// 공통 앱 도메인 첫 화면의 앱 보기 (D1 "넘겨 보는 앱 카드", 사용자 시안 2026-11-28): 소개와 같은 어두운 점 바탕 위에
// 밝은 카드가 옆으로 늘어서고, 손가락 · 트랙패드로 넘기면 한 장씩 멈춘다(scroll-snap). 보는 카드만 밝고 나머지는 옅다.
// 아래의 번호 단계(넓은 화면) · 점(폰)과 화살표 · 키보드 ←→로도 넘긴다. 넘길 때마다 onTurn으로 점 그림을 그쪽으로 한 번 민다.
// 카드에는 그 앱의 최근 공개 글 셋(없으면 종류 그림)과 마지막 소식. 위의 "최근 소식"은 앱을 가리지 않은 최근 글 셋

const KIND_NAMES: Record<PublicApp['kind'], string> = {
  page: '페이지',
  community: '커뮤니티',
  blog: '블로그',
  magazine: '매거진',
};

/** 카드 하나: 주소는 이 도메인의 /<앱>이거나 확인한 자기 도메인. 지난 때(when)는 서버에서 글로 만들어 온다 */
export type DeckApp = {
  slug: string;
  name: string;
  kind: PublicApp['kind'];
  description: string;
  href: string;
  /** 화면에 적는 주소 (프로토콜 없이) */
  path: string;
  /** 연결을 확인한 자기 도메인으로 여는 앱 (로그인을 그 주소에서 한 번 더) */
  ownDomain: boolean;
  members: boolean;
  posts: readonly { title: string; when: string }[];
};

/** 위 "최근 소식"의 한 줄 */
export type DeckNews = { key: string; app: string; title: string; when: string };

function foot(app: DeckApp): string {
  if (app.ownDomain && app.members) return '그 주소에서 같은 계정으로 한 번 더 로그인해요';
  const [last] = app.posts;
  return last ? `새 글 ${last.when}` : `${KIND_NAMES[app.kind]} 앱`;
}

function Arrow({ d }: { d: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export function AppsDeck({
  apps,
  news,
  extra,
  extraFirst,
  onTurn,
}: {
  apps: readonly DeckApp[];
  news: readonly DeckNews[];
  /** 카드 아래에 붙는 것 (플러그인 자리 store.after: 메일 구독) */
  extra: ReactNode;
  /** 메일 링크로 왔으면 extra를 맨 위에 (확인 · 해지 카드가 먼저 보이게) */
  extraFirst: boolean;
  /** 보는 카드가 바뀌었다 (-1 앞으로 · 1 뒤로) */
  onTurn: (toward: -1 | 1) => void;
}) {
  const [at, setAt] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const atNow = useRef(0);
  const frame = useRef(0);

  const turnTo = useCallback(
    (next: number) => {
      if (next === atNow.current) return;
      onTurn(next > atNow.current ? 1 : -1);
      atNow.current = next;
      setAt(next);
    },
    [onTurn],
  );

  /** 지금 왼쪽 끝(scroll-padding 자리)에 가장 가까운 카드. 끝까지 넘겼으면 마지막 카드 */
  const nearest = useCallback((): number => {
    const t = track.current;
    if (!t || t.children.length === 0) return 0;
    if (t.scrollLeft >= t.scrollWidth - t.clientWidth - 2) return t.children.length - 1;
    const pad = Number.parseFloat(getComputedStyle(t).scrollPaddingLeft) || 0;
    let best = 0;
    let gap = Number.POSITIVE_INFINITY;
    Array.from(t.children).forEach((c, i) => {
      const d = Math.abs((c as HTMLElement).offsetLeft - pad - t.scrollLeft);
      if (d < gap) [best, gap] = [i, d];
    });
    return best;
  }, []);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function scrolled() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => turnTo(nearest()));
  }

  function go(i: number) {
    const card = track.current?.children[i] as HTMLElement | undefined;
    if (!card) return;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
      block: 'nearest',
      inline: 'start',
    });
    turnTo(i);
  }

  function keyed(e: KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = Math.min(apps.length - 1, Math.max(0, at + (e.key === 'ArrowRight' ? 1 : -1)));
    go(next);
    (track.current?.children[next] as HTMLElement | undefined)?.focus({ preventScroll: true });
  }

  const no = (i: number) => String(i + 1).padStart(2, '0');
  return (
    <section className="dk" aria-labelledby="dk-title">
      {extra && extraFirst && <div className="dk-extra">{extra}</div>}
      <div className="dk-head">
        <div>
          <p className="fd-mono fd-muted">앱 — {apps.length}개</p>
          <h2 id="dk-title" className="dk-h2">
            옆으로 넘기며 골라요
          </h2>
        </div>
        {news.length > 0 && (
          <ul className="dk-news" aria-label="최근 소식">
            {news.map((n) => (
              <li key={n.key}>
                <span className="dk-dot" aria-hidden="true" />
                {n.app} · {n.title}
                <span className="fd-mono fd-muted">{n.when}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {apps.length === 0 ? (
        <p className="dk-empty fd-muted">공개한 앱이 아직 없어요</p>
      ) : (
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: ←→는 안의 카드(링크)에 포커스가 있을 때 넘기는 지름길이다 */}
          <div className="dk-track" ref={track} onScroll={scrolled} onKeyDown={keyed}>
            {apps.map((a, i) => (
              <a
                key={a.slug}
                href={a.href}
                className={`dk-card${i === at ? ' is-on' : ''}`}
                aria-label={`${a.name} 열기 (${i + 1}/${apps.length})`}
              >
                <span className="dk-row">
                  <span className="dk-tags">
                    <span className="dk-tag">{KIND_NAMES[a.kind]}</span>
                    {a.ownDomain && <span className="dk-tag">자기 도메인</span>}
                    {a.members && <span className="dk-tag">회원</span>}
                  </span>
                  <span className="fd-mono dk-path">{a.path}</span>
                </span>
                <span>
                  <span className="dk-name">{a.name}</span>
                  {a.description && <span className="dk-desc">{a.description}</span>}
                </span>
                {a.posts.length > 0 ? (
                  <span className="dk-peek">
                    {a.posts.map((p) => (
                      <span key={`${p.title}-${p.when}`} className="dk-post">
                        <span>{p.title}</span>
                        <span className="fd-mono">{p.when}</span>
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="dk-peek is-art">
                    <AppArt kind={a.kind} />
                  </span>
                )}
                <span className="dk-foot">
                  <span>{foot(a)}</span>
                  <span className="dk-open">
                    열기
                    <Arrow d="M7 17L17 7M8 7h9v9" />
                  </span>
                </span>
              </a>
            ))}
          </div>
          <div className="dk-nav">
            <nav className="dk-steps" aria-label="앱 고르기">
              {apps.map((a, i) => (
                <button
                  key={a.slug}
                  type="button"
                  className={`dk-step${i === at ? ' is-on' : ''}`}
                  aria-pressed={i === at}
                  aria-label={a.name}
                  onClick={() => go(i)}
                >
                  <span className="fd-mono">{no(i)}</span>
                  <span className="dk-bar">{i === at && <span key={at} />}</span>
                  <span className="dk-step-name">{a.name}</span>
                </button>
              ))}
            </nav>
            <span className="fd-mono dk-count" aria-hidden="true">
              {no(at)} / {String(apps.length).padStart(2, '0')}
            </span>
            <div className="dk-arrows">
              <button
                type="button"
                className="dk-arrow"
                aria-label="이전 앱"
                disabled={at === 0}
                onClick={() => go(at - 1)}
              >
                <Arrow d="M15 6l-6 6 6 6" />
              </button>
              <button
                type="button"
                className="dk-arrow"
                aria-label="다음 앱"
                disabled={at >= apps.length - 1}
                onClick={() => go(at + 1)}
              >
                <Arrow d="M9 6l6 6-6 6" />
              </button>
            </div>
          </div>
        </>
      )}
      {extra && !extraFirst && <div className="dk-extra">{extra}</div>}
    </section>
  );
}
