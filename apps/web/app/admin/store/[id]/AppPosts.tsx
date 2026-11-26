'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { formatDate } from '../../../_blog/format';
import { POST_STATUS_LABELS } from '../../../_blog/labels';
import type { AdminApp, AdminPostList } from '../../../_blog/types';
import { useLiveValue } from '../../../_lib/use-live';
import { readPages } from '../../../_task/live';

const POST_TOPICS = ['blog.post.*'];

function mergePages(before: AdminPostList, more: AdminPostList): AdminPostList {
  return { ...more, posts: [...before.posts, ...more.posts] };
}

// 앱 관리 › 글 (스토어 1-5): 이 앱에 든 글을 고친 순서로 (초안 · 공개 · 링크 공개). 누르면 편집기.
// 새 글은 이 앱에 넣어 편집기를 연다 (?app=). 다른 앱으로 옮기기 · 빼기는 편집기의 발행 창에서
export function AppPosts({ app }: { app: AdminApp }) {
  /** 읽어 둔 쪽 수. "더 보기"로 는다 */
  const pages = useRef(1);
  const path = `/api/posts?app=${encodeURIComponent(app.slug)}`;
  const posts = useLiveValue(
    `app-posts:${app.slug}`,
    () => readPages(path, pages.current, mergePages),
    POST_TOPICS,
  );
  const list = posts.data?.posts ?? null;

  return (
    <section className="stack" aria-label="이 앱의 글">
      <div className="row">
        <b>이 앱의 글</b>
        <Link className="cta small" href={`/admin/posts/new?app=${app.id}`}>
          새 글
        </Link>
      </div>
      {posts.error && <p className="error">{posts.error}</p>}
      {list === null ? (
        !posts.error && <p className="label-mono loading">불러오는 중…</p>
      ) : list.length === 0 ? (
        <p className="rows-empty">이 앱의 글 없음 · 보관함 › 글에서 앱으로 옮길 수 있음</p>
      ) : (
        <ul className="list">
          {list.map((p) => (
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
      {posts.data?.next && (
        <button
          type="button"
          className="ghost"
          onClick={() => {
            pages.current += 1;
            void posts.reload();
          }}
        >
          더 보기
        </button>
      )}
    </section>
  );
}
