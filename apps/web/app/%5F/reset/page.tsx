import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { isAppsHost } from '../../_blog/apps-domain';
import { hostOf } from '../../_blog/request-host';
import { siteNow } from '../../_blog/site';
import { AuthField } from '../../_community/AuthField';
import { ResetPanel } from '../../_community/ResetPanel';
import { authReturn } from '../../_community/SharedAuth';
import type { MemberMe } from '../../_community/types';
import { serverGet } from '../../_lib/server-api';

// 앱 없는 비밀번호 다시 정하기 (2026-11-28, 공통 앱 도메인의 /_/reset?return=): 메일로 받은 인증코드로 새 비밀번호를 정한다 (api/store).
// 화면은 C안의 계정 화면(AuthField). 공통 앱 도메인이 아니면 없는 주소. 로그인해 있으면 내 정보의 비밀번호 바꾸기를 쓰므로 돌아갈 곳으로.
// 정하면 /_/login으로
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ return?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const site = await siteNow();
  const title = '비밀번호 다시 정하기';
  return { title: site?.space.name ? `${title} · ${site.space.name}` : title };
}

export default async function SharedResetPage({ searchParams }: Props) {
  const host = hostOf(await headers());
  if (!isAppsHost(host)) notFound();
  const back = authReturn((await searchParams).return);
  const [me, site] = await Promise.all([
    serverGet<MemberMe>('/api/store/me', false, host),
    siteNow(),
  ]);
  if (me?.account) redirect(back);
  return (
    <AuthField
      site={site?.space.name || 'Moida'}
      logo={site?.space.logoUrl ?? null}
      kicker="계정 — 비밀번호"
      title={['메일로 받은 코드로', '비밀번호를 다시 정해요']}
      sub="새 비밀번호를 정하면 모든 앱 · 기기에서 로그아웃돼요. 가입한 메일이 아니면 코드가 가지 않아요."
      label="비밀번호 다시 정하기"
    >
      <h2>비밀번호 다시 정하기</h2>
      <ResetPanel base="" csrf={me?.csrf ?? null} returnTo={back} shared />
    </AuthField>
  );
}
