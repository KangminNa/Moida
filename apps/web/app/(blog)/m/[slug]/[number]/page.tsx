import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SpaceInfo } from '../../../../_account/types';
import { formatDate, menuPath, postPath } from '../../../../_blog/format';
import type { PublicIssue } from '../../../../_blog/types';
import { serverGet } from '../../../../_lib/server-api';

// 매거진 호 하나 (/m/<메뉴>/<번호>, 2차 6단계): 발행한 호의 소개와 글을 순서대로. 방문자로 묻는다.
export const dynamic = 'force-dynamic';

type Params = { slug: string; number: string };

function issueOf({ slug, number }: Params): Promise<PublicIssue | null> {
  const menu = encodeURIComponent(decodeURIComponent(slug));
  return serverGet<PublicIssue>(
    `/api/issues/by-number/${menu}/${encodeURIComponent(number)}`,
    true,
  );
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const [space, issue] = await Promise.all([
    serverGet<SpaceInfo>('/api/space', true),
    issueOf(await params),
  ]);
  const name = space?.name || 'Cairn';
  return { title: issue ? `${issue.number}호 ${issue.title} · ${name}` : name };
}

export default async function IssueScreen({ params }: { params: Promise<Params> }) {
  const found = await params;
  const issue = await issueOf(found);
  if (!issue) notFound();
  return (
    <main className="blog-main">
      <a className="blog-back" href={menuPath(decodeURIComponent(found.slug))}>
        ← 호 목록
      </a>
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
            <a href={postPath(p.slug)}>
              <h2>{p.title}</h2>
              {p.excerpt && <p>{p.excerpt}</p>}
            </a>
          </li>
        ))}
      </ol>
    </main>
  );
}
