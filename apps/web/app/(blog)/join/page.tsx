import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { appsOrigin } from '../../_blog/apps-domain';
import { SiteFooter } from '../../_blog/SiteFooter';
import { joinableApps } from '../../_blog/StoreJoin';
import { siteNow } from '../../_blog/site';
import type { Term } from '../../_community/types';
import { serverGet } from '../../_lib/server-api';
import { StoreJoinPanel } from './StoreJoinPanel';

// 스토어 가입 (2026-11-26, 사용자 "스토어 가입을 넣고 회원가입 페이지 따로 만들어줘"): 스토어 첫 화면의 "가입하기"가 오는 화면.
// 계정만 만들고(로그인 없음: 기본 도메인은 콘솔과 같은 출처라 회원 쿠키를 두지 않는다) 끝나면 로그인할 앱을 고른다.
// 공통 약관 둘을 읽어 동의 칸에. 회원을 받는 앱(자기 도메인)이 없으면 가입해도 쓸 곳이 없어 받지 않는다
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const site = await siteNow();
  return { title: site?.space.name ? `가입 · ${site.space.name}` : '가입' };
}

export default async function StoreJoinPage() {
  const site = await siteNow();
  if (!site)
    return (
      <main className="blog-main">
        <p className="blog-empty">서버에 연결하지 못했어요</p>
      </main>
    );
  if (!site.space.installed) redirect('/install');
  const [terms, privacy] = await Promise.all([
    serverGet<Term>('/api/store/terms/terms', true),
    serverGet<Term>('/api/store/terms/privacy', true),
  ]);
  const apps = joinableApps(site.apps, appsOrigin());
  return (
    <>
      <header className="blog-top">
        <a className="blog-brand" href="/">
          {site.space.name || 'Moida'}
        </a>
      </header>
      <main className="blog-main member-main">
        <section className="panel-card member-card" aria-label="가입">
          <h1>가입</h1>
          <StoreJoinPanel apps={apps} terms={terms} privacy={privacy} />
        </section>
      </main>
      <SiteFooter site={site} />
    </>
  );
}
