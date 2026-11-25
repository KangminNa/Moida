import { StorePanel } from './StorePanel';

export const metadata = { title: '스토어 · Cairn', robots: { index: false } };

// 스토어 (스토어 1-5 → 2026-11-25 A4): 새 앱 만들기. 페이지는 틀만 두고 읽기 · 쓰기는 패널이 한다.
// 만들기 시트는 주소(?make=1)에 둔다: 폰의 뒤로 가기가 시트만 닫고, 새로 고쳐도 시트가 그대로 (웹 UX U1)
export default async function StoreNewPage({
  searchParams,
}: {
  searchParams: Promise<{ make?: string }>;
}) {
  const { make } = await searchParams;
  return (
    <section className="console-inner narrow" aria-label="스토어">
      <StorePanel make={make ?? null} />
    </section>
  );
}
