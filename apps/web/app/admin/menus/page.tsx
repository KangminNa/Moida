import { MenusPanel } from './MenusPanel';

export const metadata = { title: '메뉴 · Cairn', robots: { index: false } };

// 블로그 메뉴 (2차 6단계): 공개 블로그 위쪽 메뉴 줄. 페이지는 틀만 두고 읽기 · 쓰기는 패널이 한다.
export default function MenusPage() {
  return (
    <section className="console-inner narrow" aria-label="메뉴">
      <MenusPanel />
    </section>
  );
}
