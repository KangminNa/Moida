import { formatDate, postPath } from './format';
import type { PublicIssue } from './types';

// 매거진 호 하나의 본문 (스토어 1-4): 번호 · 제목 · 발행일 · 소개와 글을 순서대로. 호 화면과 매거진 앱의 첫 화면이 쓴다
export function IssueBody({ issue, app }: { issue: PublicIssue; app: string }) {
  return (
    <>
      <h1 className="blog-menu-title">
        {issue.number}호 · {issue.title}
      </h1>
      <p className="post-meta">
        <time dateTime={issue.publishedAt ?? undefined}>{formatDate(issue.publishedAt)}</time>
      </p>
      {issue.intro && <p className="blog-intro">{issue.intro}</p>}
      <ol className="post-list">
        {issue.posts.map((p) => (
          <li key={p.slug}>
            <a href={postPath(p.slug, app)}>
              <h2>{p.title}</h2>
              {p.excerpt && <p>{p.excerpt}</p>}
            </a>
          </li>
        ))}
      </ol>
    </>
  );
}
