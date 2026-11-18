'use client';

import Link from 'next/link';
import { formatDate } from '../../../_blog/format';
import { POST_STATUS_LABELS } from '../../../_blog/labels';
import type { AdminApp, AdminPostList } from '../../../_blog/types';
import { api } from '../../../_lib/client-api';
import { useLiveValue } from '../../../_lib/use-live';
import { STORE_HREF } from '../../menu';

const POST_TOPICS = ['blog.post.*'];
const RECENT = 5;

// 앱 관리 › 개요 (스토어 1-5): 든 것의 수와 최근에 고친 글 다섯. 승인 대기 · 운영 팀의 진행은 2단계(앱별 운영)
export function AppOverview({ app }: { app: AdminApp }) {
  const posts = useLiveValue(
    `app-posts:${app.slug}`,
    () => api<AdminPostList>('GET', `/api/posts?app=${encodeURIComponent(app.slug)}`),
    POST_TOPICS,
  );
  const c = app.counts;
  const recent = posts.data?.posts.slice(0, RECENT) ?? null;
  const counts: readonly [string, number | undefined][] =
    app.kind === 'page'
      ? [['페이지', c?.pages]]
      : [
          ['공개 글', c?.published],
          ['초안', c?.drafts],
          ['메뉴', c?.menus],
          ['페이지', c?.pages],
        ];

  return (
    <>
      <ul className="app-counts" aria-label="든 것의 수">
        {counts.map(([label, n]) => (
          <li key={label} className="panel">
            <b>{n ?? '–'}</b>
            <small>{label}</small>
          </li>
        ))}
      </ul>
      {app.kind !== 'page' && (
        <section className="stack" aria-label="최근 글">
          <div className="row">
            <b>최근 글</b>
            <Link className="ghost small" href={`${STORE_HREF}/${app.id}?tab=posts`}>
              모두 보기
            </Link>
          </div>
          {posts.error && <p className="error">{posts.error}</p>}
          {recent === null ? (
            !posts.error && <p className="label-mono">불러오는 중…</p>
          ) : recent.length === 0 ? (
            <p className="rows-empty">이 앱의 글 없음</p>
          ) : (
            <ul className="list">
              {recent.map((p) => (
                <li key={p.id} className="list-cell">
                  <Link className="item-main" href={`/admin/posts/${p.id}`}>
                    <b>{p.title || '제목 없음'}</b>
                    <small>
                      {POST_STATUS_LABELS[p.status]} · {formatDate(p.updatedAt)}
                    </small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
