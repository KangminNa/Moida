import { notFound, redirect } from 'next/navigation';
import { menuPath, slugFrom } from '../../../../_blog/format';
import type { PublicMenuList } from '../../../../_blog/types';
import { serverGet } from '../../../../_lib/server-api';

// 옛 호 주소 /m/<메뉴>/<번호> (스토어 1-4): 그 메뉴가 있는 첫 공개 앱의 /<앱>/m/<메뉴>/<번호>로 (307)
export const dynamic = 'force-dynamic';

export default async function OldIssue({
  params,
}: {
  params: Promise<{ slug: string; number: string }>;
}) {
  const { slug, number } = await params;
  const menus = await serverGet<PublicMenuList>('/api/menus', true);
  const menu = menus?.menus.find((m) => m.slug === slugFrom(slug));
  if (!menu) notFound();
  redirect(`${menuPath(menu.slug, menu.app)}/${encodeURIComponent(number)}`);
}
