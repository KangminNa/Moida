import { notFound } from 'next/navigation';
import { AppHome } from '../../_blog/AppHome';
import { slugFrom } from '../../_blog/format';
import { appIn, siteNow } from '../../_blog/site';

// 앱의 첫 화면 (/<앱>, 스토어 1-4). 틀(머리 · 아래쪽)은 layout이 그린다
export const dynamic = 'force-dynamic';

export default async function AppScreen({
  params,
  searchParams,
}: {
  params: Promise<{ app: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const [site, { app: raw }, { cursor }] = await Promise.all([siteNow(), params, searchParams]);
  const app = site ? appIn(site, slugFrom(raw)) : null;
  if (!app) notFound();
  return <AppHome app={app} cursor={cursor ?? null} />;
}
