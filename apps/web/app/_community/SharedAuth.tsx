import { redirect } from 'next/navigation';
import { appsOrigin } from '../_blog/apps-domain';
import { joinableApps } from '../_blog/StoreJoin';
import { siteNow } from '../_blog/site';
import { safeReturnPath } from '../_lib/return-path';
import { serverGet } from '../_lib/server-api';
import { AuthTabs } from './AuthTabs';
import type { MemberMe, Term } from './types';

/** 돌아갈 곳이 계정 화면 자신이면 첫 화면으로 (로그인 뒤 다시 로그인 화면이 열리지 않게) */
const AUTH_PATHS = /^\/(?:_\/(?:login|reset)|join)(?:[/?#]|$)/;

/** 계정 화면에서 넘긴 ?return= 을 이 도메인 안의 돌아갈 곳으로 (웹 보안 S1) */
export function authReturn(raw: string | undefined): string {
  const back = safeReturnPath(raw, '/');
  return AUTH_PATHS.test(back) ? '/' : back;
}

// 공통 앱 도메인의 로그인 · 가입 화면 (C안, 2026-11-28): /_/login과 /join이 같은 화면의 탭이다.
// 서버에서 이 브라우저의 로그인 · 사이트 · 공통 약관을 읽고, 이미 로그인했으면 돌아갈 곳으로 보낸다 (웹 UX U1).
// 공통 앱 도메인인지는 부르는 page가 본다
export async function SharedAuth({
  mode,
  host,
  returnRaw,
}: {
  mode: 'login' | 'join';
  host: string | null;
  returnRaw: string | undefined;
}) {
  const back = authReturn(returnRaw);
  const [me, site, terms, privacy] = await Promise.all([
    serverGet<MemberMe>('/api/store/me', false, host),
    siteNow(),
    serverGet<Term>('/api/store/terms/terms', true),
    serverGet<Term>('/api/store/terms/privacy', true),
  ]);
  if (me?.account) redirect(back);
  return (
    <AuthTabs
      initial={mode}
      site={site?.space.name || 'Moida'}
      logo={site?.space.logoUrl ?? null}
      csrf={me?.csrf ?? null}
      returnTo={back}
      apps={site ? joinableApps(site.apps, appsOrigin()) : []}
      terms={terms}
      privacy={privacy}
    />
  );
}
