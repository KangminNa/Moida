'use client';

import { useState } from 'react';
import type { PublicApp } from './types';

// 공통 앱 도메인 첫 화면(C안)의 앱 목록: 종류 칩으로 거르고, 첫 앱은 큰 타일(설명 포함), 나머지는 작은 타일.
// 타일의 그림은 종류마다 점 · 선으로 그린 모양 (지도 · 커뮤니티 · 글 · 매거진). 앱 아이콘 대신 같은 결의 그림을 쓴다

/** 타일 하나: 주소는 이 도메인의 /<앱>이거나 확인한 자기 도메인 */
export type FieldApp = {
  slug: string;
  name: string;
  kind: PublicApp['kind'];
  description: string;
  href: string;
  /** 화면에 적는 주소 (프로토콜 없이) */
  path: string;
};

const KIND_NAMES: Record<PublicApp['kind'], string> = {
  page: '페이지',
  community: '커뮤니티',
  blog: '블로그',
  magazine: '매거진',
};

const KIND_ORDER: readonly PublicApp['kind'][] = ['page', 'community', 'blog', 'magazine'];

function Art({ kind }: { kind: PublicApp['kind'] }) {
  if (kind === 'community')
    return (
      <span className="fd-art" aria-hidden="true">
        <span className="fd-ring" style={{ transform: 'translate(-24%, -14%)' }} />
        <span className="fd-ring" style={{ transform: 'translate(24%, -14%)' }} />
        <span className="fd-ring fd-dots" style={{ transform: 'translate(0, 22%)' }} />
      </span>
    );
  if (kind === 'blog')
    return (
      <span className="fd-art" aria-hidden="true">
        <span className="fd-text">
          <span className="fd-dots fd-photo" />
          {[100, 84, 92, 56].map((w) => (
            <span key={w} className="fd-ln" style={{ width: `${w}%` }} />
          ))}
        </span>
      </span>
    );
  if (kind === 'magazine')
    return (
      <span className="fd-art" aria-hidden="true">
        <span className="fd-mag">
          <span className="fd-dots fd-mag-cover" />
          <span className="fd-cell" />
          <span className="fd-cell fd-solid" />
          <span className="fd-cell" />
          <span className="fd-cell" />
          <span className="fd-cell fd-dots" />
        </span>
      </span>
    );
  return (
    <span className="fd-art" aria-hidden="true">
      <span className="fd-orb" />
      <span className="fd-dots fd-disc" />
      <span className="fd-pin" style={{ left: '40%', top: '38%' }} />
      <span className="fd-pin" style={{ left: '56%', top: '31%' }} />
      <span className="fd-pin" style={{ left: '52%', top: '60%' }} />
    </span>
  );
}

export function AppsTiles({ apps }: { apps: readonly FieldApp[] }) {
  const [kind, setKind] = useState<PublicApp['kind'] | 'all'>('all');
  const kinds = KIND_ORDER.filter((k) => apps.some((a) => a.kind === k));
  const shown = apps.filter((a) => kind === 'all' || a.kind === kind);
  return (
    <section className="fd-apps" aria-labelledby="fd-apps-title">
      <div className="fd-apps-head">
        <h2 id="fd-apps-title" className="fd-h2">
          앱<span className="fd-count">({shown.length})</span>
        </h2>
        <div className="fd-apps-side">
          <p className="fd-mono fd-muted">모다가 만든 앱 · 계정 하나로 모두 써요</p>
          {kinds.length > 1 && (
            <fieldset className="fd-filters" aria-label="종류">
              {(['all', ...kinds] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`fd-chip${k === kind ? ' is-on' : ''}`}
                  aria-pressed={k === kind}
                  onClick={() => setKind(k)}
                >
                  {k === 'all' ? '전체' : KIND_NAMES[k]}
                </button>
              ))}
            </fieldset>
          )}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="fd-empty fd-muted">공개한 앱이 아직 없어요</p>
      ) : (
        <div className="fd-grid">
          {shown.map((a, i) => (
            <a key={a.slug} href={a.href} className={`fd-tile${i === 0 ? ' is-feature' : ''}`}>
              <Art kind={a.kind} />
              <span className="fd-tile-row">
                <span className="fd-mono">{KIND_NAMES[a.kind]} 앱</span>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M7 17L17 7M8 7h9v9" />
                </svg>
              </span>
              <span className="fd-tile-row is-end">
                <span>
                  <span className="fd-name">{a.name}</span>
                  {i === 0 && a.description && <span className="fd-desc">{a.description}</span>}
                </span>
                <span className="fd-mono fd-path">{a.path}</span>
              </span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
