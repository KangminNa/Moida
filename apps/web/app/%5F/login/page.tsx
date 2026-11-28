import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { isAppsHost } from '../../_blog/apps-domain';
import { hostOf } from '../../_blog/request-host';
import { siteNow } from '../../_blog/site';
import { SharedFrame } from '../../_community/SharedFrame';
import type { MemberMe } from '../../_community/types';
import { safeReturnPath } from '../../_lib/return-path';
import { serverGet } from '../../_lib/server-api';
import { SharedLoginPanel } from './SharedLoginPanel';

// 앱 없는 로그인 (2026-11-27, 공통 앱 도메인의 /_/login): 그 도메인의 쿠키는 모든 앱이 함께 써서 앱을 고르지 않고 로그인한다.
// 공통 앱 도메인이 아니면 없는 주소 (기본 도메인은 콘솔과 같은 출처라 회원 쿠키를 두지 않는다. 앱마다의 도메인은 proxy가 그 앱의 /_/login으로).
// 이미 로그인했으면 돌아갈 곳으로 (웹 UX U1). 돌아갈 곳은 이 도메인 안의 경로만, 기본은 첫 화면
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ return?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const site = await siteNow();
  return { title: site?.space.name ? `로그인 · ${site.space.name}` : '로그인' };
}

export default async function SharedLoginPage({ searchParams }: Props) {
  const host = hostOf(await headers());
  if (!isAppsHost(host)) notFound();
  const raw = safeReturnPath((await searchParams).return, '/');
  const back = /^\/_\/login(?:[/?#]|$)/.test(raw) ? '/' : raw;
  const [me, site] = await Promise.all([
    serverGet<MemberMe>('/api/store/me', false, host),
    siteNow(),
  ]);
  if (me?.account) redirect(back);
  const reset = `/_/reset?return=${encodeURIComponent(back)}`;
  return (
    <SharedFrame site={site?.space.name || 'Moida'} title="로그인">
      <SharedLoginPanel csrf={me?.csrf ?? null} returnTo={back} resetHref={reset} />
    </SharedFrame>
  );
}
