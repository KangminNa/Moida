'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { api } from '../../_lib/client-api';
import { useLiveValue } from '../../_lib/use-live';
import type { LibraryPage } from '../../_platform/types';
import { readPages } from '../../_task/live';
import type { ProjectRules } from '../../_vault/types';

/** 종류 → 화면 이름 (서버의 LIBRARY_KIND) */
const KINDS: ReadonlyArray<readonly [string, string]> = [
  ['output', '결과물'],
  ['page', '페이지'],
  ['link', '읽은 글'],
  ['session', '세션'],
  ['wiki', '위키'],
  ['post', '글'],
];
const KIND_LABELS = Object.fromEntries(KINDS);
const VISIBILITY: Record<string, string> = {
  private: '비공개',
  public: '공개',
  draft: '임시',
  published: '공개',
  unlisted: '링크 공개',
};
/** 기간: 최근 며칠 (null이면 전체) */
const PERIODS: ReadonlyArray<readonly [number | null, string]> = [
  [null, '전체'],
  [7, '최근 7일'],
  [30, '최근 30일'],
];
/** 무엇이든 새로 쌓이면 다시 읽는다 */
const TOPICS = ['task.task.changed', 'blog.page.changed', 'vault.session.*', 'vault.wiki.saved'];
const NO_TOPICS: readonly string[] = [];

function mergePages(before: LibraryPage, more: LibraryPage): LibraryPage {
  return { ...more, items: [...before.items, ...more.items] };
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

// 보관함 (2차 5단계): 결과물 · 페이지 · 읽은 글 · 세션 · 위키 · 글을 한 목록으로 (최근 것부터).
// 종류 · 기간 · 프로젝트(세션만 프로젝트를 안다)로 거르고, 줄을 누르면 그것의 화면으로. 관리(지우기 · 공개 등)는 각 화면에서
export function LibraryPanel() {
  const [kind, setKind] = useState<string | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [project, setProject] = useState<string | null>(null);
  /** 읽어 둔 쪽 수. "더 보기"로 늘고 거르기를 바꾸면 첫 쪽부터 */
  const pages = useRef(1);
  // 날짜까지만: 그리는 동안 주소가 바뀌어 다시 읽지 않게
  const from =
    days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const query = new URLSearchParams({
    ...(kind ? { kind } : {}),
    ...(project ? { project } : {}),
    ...(from ? { from } : {}),
  }).toString();
  const path = query ? `/api/library?${query}` : '/api/library';
  const list = useLiveValue(path, () => readPages(path, pages.current, mergePages), TOPICS);
  const projects = useLiveValue(
    'project-rules',
    () => api<ProjectRules>('GET', '/api/project-rules'),
    NO_TOPICS,
  );
  const items = list.data?.items ?? null;

  function pick<T>(set: (v: T) => void, value: T) {
    pages.current = 1;
    set(value);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <nav className="row" aria-label="관리">
        <Link className="ghost small" href="/admin/library/outputs">
          결과물 관리
        </Link>
        <Link className="ghost small" href="/admin/library/pages">
          페이지 관리
        </Link>
        <Link className="ghost small" href="/admin/library/basket">
          소재 관리
        </Link>
      </nav>
      <fieldset className="row" style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="sr">종류</legend>
        <button
          type="button"
          className="chip"
          aria-pressed={kind === null}
          onClick={() => pick(setKind, null)}
        >
          전체
        </button>
        {KINDS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="chip"
            aria-pressed={kind === value}
            onClick={() => pick(setKind, kind === value ? null : value)}
          >
            {label}
          </button>
        ))}
      </fieldset>
      <div className="row" style={{ gap: 12 }}>
        <fieldset className="row" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="sr">기간</legend>
          {PERIODS.map(([value, label]) => (
            <button
              key={label}
              type="button"
              className="chip"
              aria-pressed={days === value}
              onClick={() => pick(setDays, value)}
            >
              {label}
            </button>
          ))}
        </fieldset>
        {(projects.data?.projects.length ?? 0) > 0 && (
          <label className="row">
            <span className="note">프로젝트</span>
            <select
              className="input"
              value={project ?? ''}
              onChange={(e) => pick(setProject, e.target.value || null)}
            >
              <option value="">전체</option>
              {projects.data?.projects.map((p) => (
                <option key={p.project} value={p.project}>
                  {p.project}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {project && <p className="note">프로젝트로 거르면 세션만 보여요</p>}
      {list.error && <p className="error">{list.error}</p>}
      {items === null ? (
        !list.error && <p className="label-mono">불러오는 중…</p>
      ) : items.length === 0 ? (
        <div className="result">
          <b>보관한 것 없음</b>
          <p className="label-mono" style={{ margin: '6px 0 0' }}>
            결과물 · 페이지 · 보관한 페이지 · 세션 · 위키 · 글이 여기 모여요
          </p>
        </div>
      ) : (
        <ul className="list" aria-label="보관함">
          {items.map((i) => (
            <li key={`${i.kind}:${i.id}`} className="list-cell library-row">
              <span className="pill">{KIND_LABELS[i.kind] ?? i.kind}</span>
              <div className="library-main">
                <Link href={i.href} className="clamp-1">
                  <b>{i.title}</b>
                </Link>
                <small className="note">
                  {[i.project, when(i.at), VISIBILITY[i.visibility] ?? i.visibility]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </div>
              {i.url && (
                <a className="ghost small" href={i.url} target="_blank" rel="noreferrer">
                  열기
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {list.data?.next && (
        <button
          type="button"
          className="ghost wide"
          onClick={() => {
            pages.current += 1;
            void list.reload();
          }}
        >
          더 보기
        </button>
      )}
    </div>
  );
}
