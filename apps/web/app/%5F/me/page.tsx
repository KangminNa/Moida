import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { isAppsHost } from '../../_blog/apps-domain';
import { hostOf } from '../../_blog/request-host';
import { siteNow } from '../../_blog/site';
import { AuthField } from '../../_community/AuthField';
import { LeavePanel } from '../../_community/LeavePanel';
import { NewsMail } from '../../_community/NewsMail';
import { PasswordPanel } from '../../_community/PasswordPanel';
import type { MemberMe } from '../../_community/types';
import { serverGet } from '../../_lib/server-api';
import { StoreMePanel } from './StoreMePanel';

// 앱 없는 내 정보 (2026-11-28, 공통 앱 도메인의 /_/me): 계정(아이디 · 메일) · 비밀번호 바꾸기 · 소식 메일 받기 · 로그아웃 · 계정 탈퇴.
// 화면은 C안의 계정 화면(AuthField, 판이 길면 판 안에서 내린다). 앱마다의 닉네임 · 앱에서 나가기는 그 앱의 /<앱>/_/me에서.
// 공통 앱 도메인이 아니면 없는 주소, 로그인 전이면 /_/login으로
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const site = await siteNow();
  return { title: site?.space.name ? `내 정보 · ${site.space.name}` : '내 정보' };
}

export default async function SharedMePage() {
  const host = hostOf(await headers());
  if (!isAppsHost(host)) notFound();
  const [me, site] = await Promise.all([
    serverGet<MemberMe>('/api/store/me', false, host),
    siteNow(),
  ]);
  const account = me?.account;
  if (!account) redirect(`/_/login?return=${encodeURIComponent('/_/me')}`);
  const csrf = me?.csrf ?? null;
  return (
    <AuthField
      site={site?.space.name || 'Moida'}
      logo={site?.space.logoUrl ?? null}
      kicker="계정 — 내 정보"
      title={['계정 하나로', '모든 앱에 로그인돼 있어요']}
      sub="비밀번호 · 소식 메일 · 탈퇴는 모든 앱에 함께 적용돼요. 앱마다의 닉네임은 그 앱의 내 정보에서 바꿔요."
      label="내 정보"
    >
      <h2>내 정보</h2>
      <StoreMePanel csrf={csrf} account={account} />
      <PasswordPanel csrf={csrf} shared />
      <NewsMail key={`news:${account.version}`} csrf={csrf} account={account} shared />
      <LeavePanel base="" csrf={csrf} community={false} shared />
    </AuthField>
  );
}
