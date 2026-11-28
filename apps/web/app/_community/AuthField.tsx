'use client';

import { useEffect, useRef } from 'react';
import { FieldParticles } from '../_blog/field-particles';
import '../_blog/blog.css';
import './auth-field.css';

// 공통 앱 도메인의 계정 화면 틀 (C안 "로그인 · 가입", 사용자 시안 2026-11-28): 첫 화면과 같은 어두운 바탕 가득 점 그림
// (가운데 구 = 계정, 고리를 도는 작은 구 = 앱)이 왼쪽에, 소개 글이 왼쪽 아래, 밝은 판이 오른쪽에 뜬다. 폰은 글 위 · 판 아래.
// 판 안에서 글자를 치면 점이 한 번 밀려나고(0.11초에 한 번), `pulse`가 바뀌면(탭을 바꿈) 크게 한 번.
// /_/login · /join(AuthTabs) · /_/reset · /_/me가 쓴다. 판 안의 칸은 앱 화면과 같은 부품이고 모양만 auth-field.css가 바꾼다

export function AuthField({
  site,
  logo,
  kicker,
  title,
  sub,
  notes = [],
  label,
  pulse = 0,
  children,
}: {
  site: string;
  logo: string | null;
  /** 제목 위 작은 줄 (예: "계정 — 하나로 모든 앱") */
  kicker: string;
  /** 두 줄 제목 */
  title: readonly [string, string];
  sub: string;
  /** 왼쪽 아래의 번호 붙은 안내 (넓은 화면에서만) */
  notes?: readonly string[];
  /** 판의 이름 (읽어 주는 이름) */
  label: string;
  /** 바뀔 때마다 점을 크게 한 번 민다 (탭 바꾸기) */
  pulse?: number;
  children: React.ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const field = useRef<FieldParticles | null>(null);
  const typedAt = useRef(0);

  useEffect(() => {
    if (!canvas.current) return;
    try {
      field.current = new FieldParticles(canvas.current, 'account', 'left');
    } catch {
      return; // 캔버스가 없는 브라우저: 그림 없이 글과 판만
    }
    return () => field.current?.stop();
  }, []);

  useEffect(() => {
    if (pulse > 0) field.current?.pulse(0.8);
  }, [pulse]);

  function typed() {
    const now = performance.now();
    if (now - typedAt.current < 110) return;
    typedAt.current = now;
    field.current?.pulse(0.35);
  }

  return (
    <div
      className="au-root"
      onPointerMove={(e) => field.current?.pointer({ x: e.clientX, y: e.clientY })}
      onPointerLeave={() => field.current?.pointer(null)}
    >
      <canvas ref={canvas} className="au-canvas" />
      <div className="au-shade" aria-hidden="true" />
      <header className="au-top">
        <a href="/" className="au-logo">
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
          {site}
        </a>
        <nav className="au-links" aria-label="둘러보기">
          <a href="/">소개</a>
          <a href="/?view=apps">앱</a>
        </nav>
      </header>
      <div className="au-body">
        <section className="au-copy" aria-labelledby="au-title">
          <p className="au-mono au-muted">{kicker}</p>
          <h1 id="au-title" className="au-h1">
            <span className="au-line">
              <span className="au-up">{title[0]}</span>
            </span>
            <span className="au-line">
              <span className="au-up au-d1">{title[1]}</span>
            </span>
          </h1>
          <p className="au-sub au-muted">{sub}</p>
          {notes.length > 0 && (
            <ol className="au-notes">
              {notes.map((n, i) => (
                <li key={n}>
                  <span className="au-mono">0{i + 1}</span>
                  <span>{n}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="au-panel" aria-label={label} onInput={typed}>
          {children}
        </section>
      </div>
    </div>
  );
}
