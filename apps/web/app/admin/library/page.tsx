import { LibraryPanel } from './LibraryPanel';

export const metadata = { title: '보관함 · Moida', robots: { index: false } };

// 보관함 (2차 5단계): 만든 것과 모은 것을 한 목록으로. 결과물 · 페이지 · 소재의 관리는 그 아래 화면
export default function LibraryPage() {
  return (
    <section className="console-inner wide" aria-label="보관함">
      <header className="page-head">
        <h1>보관함</h1>
      </header>
      <LibraryPanel />
    </section>
  );
}
