import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { menuPath, slugFrom } from '../../../../../_blog/format';
import { IssueBody } from '../../../../../_blog/IssueBody';
import { siteNow } from '../../../../../_blog/site';
import type { PublicIssue } from '../../../../../_blog/types';
import { serverGet } from '../../../../../_lib/server-api';

// 매거진 호 하나 (/<앱>/m/<메뉴>/<번호>, 스토어 1-4): 발행한 호의 소개와 글을 순서대로. 방문자로 묻는다.
export const dynamic = 'force-dynamic';

type Params = { app: string; menu: string; number: string };

function issueOf({ app, menu, number }: Params): Promise<PublicIssue | null> {
  const [a, m] = [app, menu].map((s) => encodeURIComponent(slugFrom(s)));
  return serverGet<PublicIssue>(
    `/api/issues/by-number/${a}/${m}/${encodeURIComponent(number)}`,
    true,
  );
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const [site, issue] = await Promise.all([siteNow(), issueOf(await params)]);
  const name = site?.space.name || 'Cairn';
  return { title: issue ? `${issue.number}호 ${issue.title} · ${name}` : name };
}

export default async function IssueScreen({ params }: { params: Promise<Params> }) {
  const found = await params;
  const issue = await issueOf(found);
  if (!issue) notFound();
  const app = slugFrom(found.app);
  return (
    <main className="blog-main">
      <a className="blog-back" href={menuPath(slugFrom(found.menu), app)}>
        ← 호 목록
      </a>
      <IssueBody issue={issue} app={app} />
    </main>
  );
}
