import { formatDate, postPath } from './format';
import type { PostSummary } from './types';

// 공개 글 목록 한 쪽 (앱의 첫 화면 · 글 목록 메뉴). 다음 쪽이 있으면 more 주소로 잇는다. 글은 든 앱의 주소로.
export function PostList({
  posts,
  more,
}: {
  posts: readonly PostSummary[];
  /** 이전 글 더 보기 주소. 없으면 끝 */
  more: string | null;
}) {
  return (
    <>
      {posts.length === 0 ? (
        <p className="blog-empty">공개한 글 없음</p>
      ) : (
        <ol className="post-list">
          {posts.map((p) => (
            <li key={p.slug}>
              <a href={postPath(p.slug, p.app?.slug ?? null)}>
                <h2>{p.title}</h2>
                {p.excerpt && <p>{p.excerpt}</p>}
                <div className="post-meta">
                  <time dateTime={p.publishedAt ?? undefined}>{formatDate(p.publishedAt)}</time>
                  {p.tags.map((t) => (
                    <span key={t}>#{t}</span>
                  ))}
                </div>
              </a>
            </li>
          ))}
        </ol>
      )}
      {more && (
        <a className="blog-more" href={more}>
          이전 글 더 보기
        </a>
      )}
    </>
  );
}
