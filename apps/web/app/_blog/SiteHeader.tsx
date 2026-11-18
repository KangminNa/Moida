import type { Site } from './site';

// 사이트 화면(앱 목록 · 그래프 · 페이지 목록)의 머리 (스토어 1-4). 앱 목록(/)에서는 이름 · 소개가 본문에 크게 있어 오른쪽 끝만.
export function SiteHeader({ site, brand }: { site: Site; brand: boolean }) {
  const { space, owner } = site;
  return (
    <header className="blog-top">
      {brand ? (
        <a className="blog-brand" href="/">
          {space.logoUrl && (
            // biome-ignore lint/performance/noImgElement: 작은 로고 하나라 Next의 이미지 최적화를 거치지 않는다
            <img className="brand-logo" src={space.logoUrl} alt="" />
          )}
          {space.name || 'Cairn'}
        </a>
      ) : (
        <span />
      )}
      <nav aria-label="사이트">
        <a href={owner ? '/admin' : '/login'}>{owner ? '콘솔' : '로그인'}</a>
      </nav>
    </header>
  );
}
