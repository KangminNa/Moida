import { notFound, redirect } from 'next/navigation';
import { menuPath, slugFrom } from '../../../_blog/format';
import type { PublicMenuList } from '../../../_blog/types';
import { serverGet } from '../../../_lib/server-api';

// 옛 메뉴 주소 /m/<주소> (스토어 1-4): 그 주소의 메뉴가 있는 첫 공개 앱의 /<앱>/m/<주소>로 넘긴다.
// 앱이 비공개가 되면 넘길 곳이 바뀌므로 307. 없으면 404
export const dynamic = 'force-dynamic';

export default async function OldMenu({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const [{ slug }, { cursor }] = await Promise.all([params, searchParams]);
  const menus = await serverGet<PublicMenuList>('/api/menus', true);
  const menu = menus?.menus.find((m) => m.slug === slugFrom(slug));
  if (!menu) notFound();
  const path = menuPath(menu.slug, menu.app);
  redirect(cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path);
}
