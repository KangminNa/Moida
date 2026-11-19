import { AppPanel, type AppTab } from './AppPanel';

export const metadata = { title: '앱 관리 · Cairn', robots: { index: false } };

const TABS: readonly AppTab[] = [
  'overview',
  'community',
  'team',
  'menus',
  'posts',
  'code',
  'settings',
];

// 앱 관리 (스토어 1-5, 시안 4번): /admin/store/<앱 id>?tab=개요 · 커뮤니티(3-2) · 운영 팀(2단계) · 메뉴 · 글 · 코드(스토어 1-6) · 설정.
// 앱 종류에 없는 탭은 패널이 개요로 본다. 읽기 · 쓰기는 패널이 한다.
export default async function AppManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const current = TABS.find((t) => t === tab) ?? 'overview';
  return (
    <section className="console-inner narrow" aria-label="앱 관리">
      <AppPanel id={id} tab={current} />
    </section>
  );
}
