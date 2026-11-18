import type { Metadata } from 'next';
import { SiteFooter } from '../../_blog/SiteFooter';
import { SiteHeader } from '../../_blog/SiteHeader';
import { siteNow } from '../../_blog/site';
import { serverGet } from '../../_lib/server-api';
import { GraphBoard } from '../../_vault/GraphBoard';
import type { Graph } from '../../_vault/types';

// 공개 그래프 (사이트 하나, 공개 앱의 공개 글만). 주인이 열어도 방문자가 보는 그대로이고, 비공개는 서버에서 거른 뒤에 온다.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const site = await siteNow();
  return { title: site?.space.name ? `그래프 · ${site.space.name}` : '그래프' };
}

export default async function PublicGraph() {
  const [site, graph] = await Promise.all([siteNow(), serverGet<Graph>('/api/graph/public', true)]);
  return (
    <>
      {site && <SiteHeader site={site} brand />}
      <main className="blog-graph">
        <h1 className="sr">그래프</h1>
        {graph ? (
          <GraphBoard graph={graph} admin={false} />
        ) : (
          <p className="blog-empty">서버에 연결하지 못했어요</p>
        )}
      </main>
      {site && <SiteFooter site={site} />}
    </>
  );
}
