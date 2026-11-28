'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../_lib/client-api';
import './apps-field.css';
import { AppsDeck, type DeckApp, type DeckNews } from './AppsDeck';
import { FieldParticles, type FieldShape } from './field-particles';

// 공통 앱 도메인의 첫 화면 (C안 "가득 찬 화면", 사용자 시안 2026-11-27): 화면 가득 점 그림 위에 소개 네 단계가 5.2초마다 넘어가고,
// 아래 가운데의 떠 있는 버튼으로 소개 ↔ 앱을 바꾼다. 앱으로 가면 같은 어두운 바탕에서 점이 화면 가득 흩어지고
// 앱 카드를 옆으로 넘겨 본다 (D1, 2026-11-28: AppsDeck). 카드를 넘기면 점이 그쪽으로 한 번 쏠린다.
// 앱 보기는 주소(?view=apps)에 둔다: 폰의 뒤로 가기가 소개로 돌아오고, 새로 고쳐도 그대로다 (웹 규칙 뒤로 가기)

type View = 'intro' | 'apps';

const STAGES: readonly { name: string; title: [string, string]; sub: string; shape: FieldShape }[] =
  [
    {
      name: '맡기기',
      title: ['일 하나를', '모다에게 맡겨요'],
      sub: '대화로 말하면 모다가 일을 나눠 계획을 세워요',
      shape: 'task',
    },
    {
      name: '남는 컴퓨터',
      title: ['남는 컴퓨터들이', '나눠서 빠르게'],
      sub: '집 · 회사 · 서버의 남는 컴퓨터에 러너를 켜 두면 같은 일을 동시에 처리해요',
      shape: 'nodes',
    },
    {
      name: '나만의 MCP',
      title: ['나만의 MCP로', '내 도구를 붙여요'],
      sub: '내 자료와 도구를 MCP로 열어 두면 모다와 Claude · ChatGPT가 함께 써요',
      shape: 'orbit',
    },
    {
      name: '모으기',
      title: ['한 일은 전부', '모다가 모아요'],
      sub: '대화 · 결과 · 기록이 보관함에 쌓이고 승인한 것만 앱으로 나가요',
      shape: 'sphere',
    },
  ];

const STAGE_MS = 5200;

function viewOfUrl(): View {
  return new URLSearchParams(window.location.search).get('view') === 'apps' ? 'apps' : 'intro';
}

export function AppsField({
  name,
  logo,
  apps,
  news,
  extra,
  extraFirst,
  loginHref,
  joinHref,
  signedIn,
  initialView,
}: {
  name: string;
  logo: string | null;
  apps: readonly DeckApp[];
  news: readonly DeckNews[];
  /** 앱 보기 카드 아래 (플러그인 자리 store.after) */
  extra: ReactNode;
  /** 메일 링크로 왔으면 extra를 앱 보기 맨 위에 */
  extraFirst: boolean;
  loginHref: string | null;
  joinHref: string | null;
  /** 이 도메인에 로그인한 계정 (앱 없는 로그인 · 어느 앱에서 한 로그인이든): 보일 이름과 로그아웃의 쓰기 확인 값 */
  signedIn: { name: string; csrf: string } | null;
  initialView: View;
}) {
  const [view, setView] = useState<View>(initialView);
  const [stage, setStage] = useState(0);
  const [round, setRound] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const field = useRef<FieldParticles | null>(null);
  const pushed = useRef(false);
  const shape: FieldShape = view === 'apps' ? 'dust' : (STAGES[stage]?.shape ?? 'task');
  const shapeNow = useRef(shape);
  shapeNow.current = shape;

  useEffect(() => {
    if (!canvas.current) return;
    try {
      field.current = new FieldParticles(canvas.current, shapeNow.current);
    } catch {
      return; // 캔버스가 없는 브라우저: 그림 없이 글만
    }
    return () => field.current?.stop();
  }, []);

  useEffect(() => {
    field.current?.setShape(shape);
  }, [shape]);

  // 소개 단계는 5.2초마다 넘긴다. 단계를 누르면 그 단계부터 다시 센다 (round)
  // biome-ignore lint/correctness/useExhaustiveDependencies: round는 누를 때 타이머를 다시 거는 신호다
  useEffect(() => {
    if (view !== 'intro' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setStage((s) => (s + 1) % STAGES.length), STAGE_MS);
    return () => window.clearInterval(timer);
  }, [view, round]);

  useEffect(() => {
    const sync = () => setView(viewOfUrl());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const show = useCallback((next: View) => {
    if (next === viewOfUrl()) return;
    if (next === 'apps') {
      window.history.pushState(null, '', '?view=apps');
      pushed.current = true;
      setView('apps');
    } else if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else {
      window.history.replaceState(null, '', window.location.pathname);
      setView('intro');
    }
  }, []);

  // 다음 카드로 가면 카드가 왼쪽으로 흐르니 점도 왼쪽으로
  const turned = useCallback((toward: -1 | 1) => field.current?.pulse(0.7, -toward), []);

  const now = STAGES[stage] ?? STAGES[0];
  return (
    <div
      className={`fd-root ${view === 'apps' ? 'is-apps' : 'is-intro'}`}
      onPointerMove={(e) => field.current?.pointer({ x: e.clientX, y: e.clientY })}
      onPointerLeave={() => field.current?.pointer(null)}
    >
      <canvas ref={canvas} className="fd-canvas" />
      <header className="fd-top">
        <a href="/" className="fd-logo">
          {logo ? (
            // biome-ignore lint/performance/noImgElement: 작은 로고 하나라 Next의 이미지 최적화를 거치지 않는다
            <img src={logo} alt="" width={22} height={22} />
          ) : (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <circle
                cx="11"
                cy="11"
                r="9.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeDasharray="1.4 2.6"
              />
              <circle cx="11" cy="11" r="3" fill="currentColor" />
            </svg>
          )}
          {name}
        </a>
        <nav className="fd-account" aria-label="계정">
          {signedIn ? (
            <>
              <a className="fd-who" href="/_/me" aria-label={`내 정보: ${signedIn.name}`}>
                {signedIn.name}
              </a>
              <button
                type="button"
                onClick={async () => {
                  const reply = await api('POST', '/api/store/logout', undefined, {
                    'x-cairn-csrf': signedIn.csrf,
                  });
                  if (reply.ok) window.location.reload();
                }}
              >
                로그아웃
              </button>
            </>
          ) : (
            <>
              {loginHref && <a href={loginHref}>로그인</a>}
              {joinHref && <a href={joinHref}>가입</a>}
            </>
          )}
        </nav>
      </header>

      {view === 'intro' && now && (
        <>
          <div className="fd-mid" aria-hidden="true">
            <span>모다 — 모든 걸 모으는 에이전트</span>
            <span>Personal AI OS</span>
          </div>
          <section className="fd-copy" aria-labelledby="fd-title" aria-live="polite">
            <p className="fd-mono fd-muted">
              0{stage + 1} / 0{STAGES.length} — {now.name}
            </p>
            <h1 id="fd-title" key={stage} className="fd-h1">
              <span className="fd-line">
                <span className="fd-up">{now.title[0]}</span>
              </span>
              <span className="fd-line">
                <span className="fd-up fd-d1">{now.title[1]}</span>
              </span>
            </h1>
            <p key={`sub-${stage}`} className="fd-sub fd-muted">
              {now.sub}
            </p>
          </section>
          <nav className="fd-stages" aria-label="Moida가 일하는 순서">
            {STAGES.map((s, i) => (
              <button
                key={s.name}
                type="button"
                className={`fd-stage${i === stage ? ' is-on' : ''}`}
                aria-pressed={i === stage}
                onClick={() => {
                  setStage(i);
                  setRound((r) => r + 1);
                }}
              >
                <span className="fd-mono">0{i + 1}</span>
                <span className="fd-bar">
                  {i === stage && <span key={`${stage}-${round}`} className="fd-fill" />}
                </span>
                <span>{s.name}</span>
              </button>
            ))}
          </nav>
        </>
      )}

      {view === 'apps' && (
        <AppsDeck apps={apps} news={news} extra={extra} extraFirst={extraFirst} onTurn={turned} />
      )}

      <nav className="fd-pill" aria-label="보기">
        <button
          type="button"
          className={`fd-seg${view === 'intro' ? ' is-on' : ''}`}
          aria-pressed={view === 'intro'}
          onClick={() => show('intro')}
        >
          소개
        </button>
        <span className="fd-div" aria-hidden="true" />
        <button
          type="button"
          className={`fd-seg${view === 'apps' ? ' is-on' : ''}`}
          aria-pressed={view === 'apps'}
          onClick={() => show('apps')}
        >
          앱
        </button>
      </nav>
    </div>
  );
}
