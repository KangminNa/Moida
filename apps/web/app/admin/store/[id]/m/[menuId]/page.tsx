import { MenuIssuesPanel } from './MenuIssuesPanel';

export const metadata = { title: '호 · Cairn', robots: { index: false } };

// 호 목록 메뉴 하나의 매거진 호 (2차 6단계, 스토어 1-5에서 앱 관리 아래로: /admin/store/<앱>/m/<메뉴>). 읽기 · 쓰기는 패널이 한다.
export default async function MenuIssuesPage({
  params,
}: {
  params: Promise<{ id: string; menuId: string }>;
}) {
  const { id, menuId } = await params;
  return (
    <section className="console-inner narrow" aria-label="호">
      <MenuIssuesPanel appId={id} menuId={menuId} />
    </section>
  );
}
