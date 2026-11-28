import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { isAppsHost } from '../../_blog/apps-domain';
import { hostOf } from '../../_blog/request-host';
import { siteNow } from '../../_blog/site';
import { SharedAuth } from '../../_community/SharedAuth';

// 앱 없는 로그인 (2026-11-27, 공통 앱 도메인의 /_/login): 그 도메인의 쿠키는 모든 앱이 함께 써서 앱을 고르지 않고 로그인한다.
// 공통 앱 도메인이 아니면 없는 주소 (기본 도메인은 콘솔과 같은 출처라 회원 쿠키를 두지 않는다. 앱마다의 도메인은 proxy가 그 앱의 /_/login으로).
// 화면은 C안의 로그인 · 가입 탭(SharedAuth, 2026-11-28). 이미 로그인했으면 돌아갈 곳으로 (웹 UX U1)
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ return?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const site = await siteNow();
  return { title: site?.space.name ? `로그인 · ${site.space.name}` : '로그인' };
}

export default async function SharedLoginPage({ searchParams }: Props) {
  const host = hostOf(await headers());
  if (!isAppsHost(host)) notFound();
  return <SharedAuth mode="login" host={host} returnRaw={(await searchParams).return} />;
}
