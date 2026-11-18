import { StorePanel } from './StorePanel';

export const metadata = { title: '스토어 · Cairn', robots: { index: false } };

// 스토어 (스토어 1-5): 앱 종류를 골라 새 앱 만들기. 페이지는 틀만 두고 읽기 · 쓰기는 패널이 한다.
export default function StoreNewPage() {
  return (
    <section className="console-inner narrow" aria-label="스토어">
      <StorePanel />
    </section>
  );
}
