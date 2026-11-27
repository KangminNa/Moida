import { headers } from 'next/headers';
import type { MemberMe } from '../_community/types';
import { serverGet } from '../_lib/server-api';
import { AppsField } from './AppsField';
import type { FieldApp } from './AppsTiles';
import { hostOf } from './request-host';
import { joinableApps, joinHref } from './StoreJoin';
import type { Site } from './site';

// 공통 앱 도메인(CAIRN_APPS_URL)의 첫 화면 (C안, 2026-11-27): 서버에서 공개 앱 목록을 타일 모양으로 다듬어 AppsField에 넘긴다.
// 고정한 앱(첫 화면 앱)을 맨 앞 큰 타일로. 앱 링크는 이 도메인의 /<앱>(같은 출처)이거나 확인한 자기 도메인.
// 로그인은 앱 없는 /_/login (2026-11-27, 쿠키는 이 도메인의 모든 앱이 함께 쓴다). 로그인했으면 머리에 아이디와 로그아웃

/** 화면에 적는 주소: https://를 떼고, 이 도메인의 /<앱>이면 도메인을 붙인다 */
function shownPath(url: string, appsHost: string): string {
  return /^https?:\/\//.test(url)
    ? url.replace(/^https?:\/\//, '').replace(/\/$/, '')
    : `${appsHost}${url}`;
}

export async function AppsHome({
  site,
  appsOrigin,
  view,
}: {
  site: Site;
  appsOrigin: string;
  view: 'intro' | 'apps';
}) {
  const { space } = site;
  const appsHost = new URL(appsOrigin).host;
  const ordered = [...site.apps].sort((a, b) => Number(b.home) - Number(a.home));
  const apps: FieldApp[] = ordered.map((a) => ({
    slug: a.slug,
    name: a.name,
    kind: a.kind,
    description: a.description ?? '',
    href: a.url,
    path: shownPath(a.url, appsHost),
  }));
  const joinable = joinableApps(site.apps, appsOrigin);
  const me = await serverGet<MemberMe>('/api/store/me', false, hostOf(await headers()));
  const account = me?.account ?? null;
  return (
    <AppsField
      name={space.name || 'Moida'}
      logo={space.logoUrl ?? null}
      apps={apps}
      loginHref={joinable.length > 0 ? '/_/login' : null}
      joinHref={joinHref(joinable)}
      signedIn={
        account && me?.csrf
          ? { name: account.loginId ?? account.email ?? '내 계정', csrf: me.csrf }
          : null
      }
      initialView={view}
    />
  );
}
