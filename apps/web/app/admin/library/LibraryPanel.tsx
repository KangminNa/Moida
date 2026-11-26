'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useApps } from '../../_blog/live';
import type { EditablePost, MenuList, PageDetail } from '../../_blog/types';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { usePicks } from '../../_lib/use-picks';
import type { LibraryPage, LibraryTrashed } from '../../_platform/types';
import { readPages } from '../../_task/live';
import { NewTabLink } from '../../_ui/NewTabLink';
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

/** 줄의 종류마다 올릴 수 있는 메뉴 종류 (서버 Menu.assertHolds와 같다) */
const MENU_KINDS: Record<string, readonly string[]> = {
  post: ['posts'],
  page: ['pages', 'page'],
};

/** 한 번에 휴지통으로 보낼 수 있는 수 (서버 TrashLibraryInput.MAX) */
const TRASH_MAX = 100;
/** 줄의 열쇠: 종류와 id (종류마다 id가 따로라 함께 둔다) */
const keyOf = (i: { kind: string; id: string }) => `${i.kind}:${i.id}`;

function when(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

// 보관함 (2차 5단계): 결과물 · 페이지 · 읽은 글 · 세션 · 위키 · 글을 한 목록으로 (최근 것부터).
// 종류 · 기간 · 프로젝트(세션만 프로젝트를 안다)로 거르고, 줄을 누르면 그것의 화면으로. 공개 등 관리는 각 화면에서.
// 여럿 골라 휴지통으로 (2026-11-23 일괄 지우기): 종류마다 그 휴지통으로 가고(되살리기는 각 화면), 스크랩은 바로 지우고, 페이지는 페이지 화면에서.
// 글 · 페이지 줄에서 블로그 메뉴에 올린다 (2차 6단계, 공개 대기. 공개는 글의 공개 범위 · 페이지의 공개로)
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
  const menus = useLiveValue('menus', () => api<MenuList>('GET', '/api/menus'), NO_TOPICS);
  /** 메뉴 이름 앞에 붙일 앱 이름 (스토어 1-5: 메뉴 주소는 앱 안에서 하나라 이름이 겹칠 수 있다) */
  const apps = useApps();
  const appName = (id: string) => apps.data?.apps.find((a) => a.id === id)?.name ?? '';
  const place = useAction();
  const trash = useAction();
  const picks = usePicks();
  const items = list.data?.items ?? null;

  /** 고른 줄을 휴지통으로. 되살리기는 그 종류의 화면(위키 · 세션 · 결과물 · 글의 휴지통)에서 */
  function trashPicked() {
    const picked = [...picks.picked].map((key) => {
      const at = key.indexOf(':');
      return { kind: key.slice(0, at), id: key.slice(at + 1) };
    });
    if (
      !window.confirm(
        `${picked.length}개를 휴지통으로 보낼까요? 각 화면의 휴지통에서 되살릴 수 있어요. 스크랩은 바로 지워지고 페이지는 페이지 화면에서 지워요`,
      )
    )
      return;
    void trash.run(
      'picked',
      () => api<LibraryTrashed>('POST', '/api/library/trash', { items: picked }),
      {
        done: (d) =>
          `${d.trashed}개 휴지통으로${d.skipped.length > 0 ? ' · 페이지는 페이지 화면에서 지워요' : ''}`,
        reload: () => {
          picks.clear();
          return list.reload();
        },
      },
    );
  }

  /** 메뉴에 올리기 · 빼기: 지금 version을 읽어 함께 보낸다 (보관함 줄에는 version이 없다) */
  function moveTo(kind: string, id: string, menuId: string | null) {
    const path = kind === 'post' ? `/api/posts/${id}` : `/api/pages/${id}`;
    void place.run(
      id,
      async () => {
        const now = await (kind === 'post'
          ? api<EditablePost>('GET', path)
          : api<PageDetail>('GET', path));
        if (!now.ok) return now;
        const { version } = now.data;
        return kind === 'post'
          ? api('POST', `${path}/menu`, { version, menuId })
          : api('PATCH', path, { version, menuId });
      },
      { done: menuId ? '메뉴에 올림' : '메뉴에서 뺌', reload: list.reload },
    );
  }

  function pick<T>(set: (v: T) => void, value: T) {
    pages.current = 1;
    set(value);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
      {place.problem && <p className="error">{place.problem}</p>}
      {trash.problem && <p className="error">{trash.problem}</p>}
      {items && items.length > 0 && (
        <div className="row">
          <button
            type="button"
            className="ghost small"
            onClick={() =>
              picks.size === items.length ? picks.clear() : picks.all(items.map(keyOf))
            }
          >
            {picks.size === items.length ? '고르기 풀기' : '보이는 것 모두 고르기'}
          </button>
          {picks.size > 0 && (
            <button
              type="button"
              className="ghost small"
              disabled={trash.busy !== null || picks.size > TRASH_MAX}
              onClick={trashPicked}
            >
              고른 {picks.size}개 휴지통으로
            </button>
          )}
          {picks.size > TRASH_MAX && <small className="note">한 번에 {TRASH_MAX}개까지</small>}
        </div>
      )}
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
        <ul className="list library-grid" aria-label="보관함">
          {items.map((i) => (
            <li key={keyOf(i)} className="list-cell library-row">
              <label className="row library-pick">
                <input
                  type="checkbox"
                  aria-label={`${i.title} 고르기`}
                  checked={picks.has(keyOf(i))}
                  onChange={() => picks.toggle(keyOf(i))}
                />
                <span className="pill">{KIND_LABELS[i.kind] ?? i.kind}</span>
              </label>
              <div className="library-main">
                <Link href={i.href} className="clamp-1">
                  <b>{i.title}</b>
                </Link>
                <small className="note">
                  {[i.project, when(i.at), VISIBILITY[i.visibility] ?? i.visibility, i.place]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </div>
              {MENU_KINDS[i.kind] && (menus.data?.menus.length ?? 0) > 0 && (
                <select
                  className="input small"
                  aria-label={`${i.title} 메뉴`}
                  value={i.placeId ?? ''}
                  disabled={place.busy === i.id}
                  onChange={(e) => moveTo(i.kind, i.id, e.target.value || null)}
                >
                  <option value="">메뉴 없음</option>
                  {menus.data?.menus
                    .filter((m) => MENU_KINDS[i.kind]?.includes(m.kind))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {appName(m.appId)} › {m.name}
                      </option>
                    ))}
                </select>
              )}
              {i.url && (
                <NewTabLink className="ghost small" href={i.url}>
                  열기
                </NewTabLink>
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
