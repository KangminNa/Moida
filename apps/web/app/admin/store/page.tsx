import { AppsPanel } from './AppsPanel';

export const metadata = { title: '내 앱 · Moida', robots: { index: false } };

// 내 앱 (스토어 1-5): 만든 앱 카드. 페이지는 틀만 두고 읽기 · 쓰기는 패널이 한다.
export default function StorePage() {
  return (
    <section className="console-inner narrow" aria-label="내 앱">
      <AppsPanel />
    </section>
  );
}
