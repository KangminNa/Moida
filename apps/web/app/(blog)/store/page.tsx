import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SiteFooter } from '../../_blog/SiteFooter';
import { StoreHome } from '../../_blog/StoreHome';
import { siteNow } from '../../_blog/site';

// 스토어 첫 화면 (2026-11-26): 첫 화면(/)이 앱 하나로 고정됐거나 공개 앱이 하나뿐이어도 여기서는 늘 앱 목록이 보인다.
// 메일 링크(플러그인 email의 구독 확인 · 해지)가 ?mail=…&token=…으로 여기에 온다: 값은 store.after 자리에 넘기기만 한다
export const dynamic = 'force-dynamic';

type Search = { mail?: string; token?: string };

export async function generateMetadata(): Promise<Metadata> {
  const site = await siteNow();
  return {
    title: site?.space.name ? `${site.space.name} 스토어` : '스토어',
    description: site?.space.description,
    // 메일 링크의 토큰이 든 주소가 검색에 남지 않게, 바깥으로 Referer가 새지 않게
    robots: { index: false },
    referrer: 'no-referrer',
  };
}

/** 주소의 값: 짧은 글자만 (그 밖은 없는 것으로) */
function word(value: string | undefined, max: number): string | null {
  return value && /^[A-Za-z0-9_-]+$/.test(value) && value.length <= max ? value : null;
}

export default async function Store({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const site = await siteNow();
  if (!site)
    return (
      <main className="blog-main">
        <p className="blog-empty">서버에 연결하지 못했어요</p>
      </main>
    );
  if (!site.space.installed) redirect('/install');
  return (
    <>
      <StoreHome
        site={site}
        mail={{ mail: word(search.mail, 20), token: word(search.token, 100) }}
      />
      <SiteFooter site={site} />
    </>
  );
}
