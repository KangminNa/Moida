import { renderMarkdown } from '../_lib/markdown';
import { Slot } from '../_plugins/Slot';
import { formatDate } from './format';
import type { PostPage } from './types';

// 글 하나의 본문 (스토어 1-4: /<앱>/posts/<글>과 고정 주소 /posts/<글>의 관리자 미리 보기가 함께 쓴다).
// back: 아래쪽 "글 목록"이 돌아갈 곳. hidden: 앱이 비공개이거나 앱 밖이라 방문자에게 안 보이는 글 (관리자 미리 보기)
export function PostArticle({
  post,
  back,
  hidden = false,
}: {
  post: PostPage;
  back: string;
  hidden?: boolean;
}) {
  return (
    <main className="blog-main">
      <article className="post">
        {post.status === 'draft' && (
          <p className="post-note">초안 미리 보기 · 방문자에게 안 보임</p>
        )}
        {hidden && post.status !== 'draft' && (
          <p className="post-note">비공개 앱 · 앱 밖의 글 미리 보기 · 방문자에게 안 보임</p>
        )}
        {!hidden && post.status === 'unlisted' && (
          <p className="post-note">링크 공개 글 · 목록과 검색에 안 보임</p>
        )}
        <header className="post-head">
          <h1>{post.title}</h1>
          <div className="post-meta">
            {post.publishedAt && (
              <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
            )}
            {post.tags.map((t) => (
              <span key={t}>#{t}</span>
            ))}
          </div>
        </header>
        <div
          className={`prose${post.align === 'center' ? ' center' : ''}`}
          // 서버의 md → HTML은 본문의 HTML을 그리지 않고 결과를 한 번 더 거른다 (_lib/markdown.ts)
          // biome-ignore lint/security/noDangerouslySetInnerHtml: 위에서 거른 HTML
          dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body) }}
        />
        <Slot
          name="post.after"
          context={{ postId: post.slug, slug: post.slug, title: post.title }}
        />
        <footer className="post-foot">
          <a href={back}>← 글 목록</a>
        </footer>
      </article>
    </main>
  );
}
