import type { Site } from './site';

// 사이트 화면의 아래쪽 (스토어 1-4): 그래프는 공개 글이 있을 때만, 페이지 목록은 공개 페이지가 있을 때만, 사이트(회사) 이름
export function SiteFooter({ site }: { site: Site }) {
  return (
    <footer className="blog-foot">
      {site.posts && <a href="/graph">그래프</a>}
      {site.pages && <a href="/pages">페이지</a>}
      {site.space.name && (
        <span>
          © {new Date().getFullYear()} {site.space.name}
        </span>
      )}
      <span>Cairn으로 만듦</span>
    </footer>
  );
}
