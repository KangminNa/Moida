import { headers } from 'next/headers';
import type { MemberMe } from '../_community/types';
import { serverGet } from '../_lib/server-api';
import { ago } from '../_lib/time-ago';
import { Slot } from '../_plugins/Slot';
import type { DeckApp, DeckNews } from './AppsDeck';
import { AppsField } from './AppsField';
import { isAppsHost } from './apps-domain';
import { hostOf } from './request-host';
import { joinableApps, joinHref } from './StoreJoin';
import type { Site } from './site';

// 첫 화면 (C안 소개 + D1 넘겨 보는 앱 카드, 2026-11-28): 공통 앱 도메인(CAIRN_APPS_URL)의 / 와 기본 도메인의 / · /store가 모두 이것.
// 옛 스토어 첫 화면(StoreHome)은 지웠다 (사용자 "기존에 store에 만든건 지워줘", 2026-11-28). 서버에서 공개 앱마다 최근 공개 글 셋을
// 붙여 AppsField에 넘긴다. 고정한 앱(첫 화면 앱)을 맨 앞에. 앱 링크는 이 도메인의 /<앱>(같은 출처)이거나 확인한 자기 도메인.
// 로그인은 공통 앱 도메인에서만 앱 없는 /_/login (그 밖의 도메인은 앱마다 그 도메인에서). 로그인했으면 머리에 아이디와 로그아웃.
// 메일 링크(플러그인 email의 구독 확인 · 해지, /store?mail=…&token=…)는 앱 보기의 맨 위에 그 카드를 띄운다 (store.after 자리)

/** 메일 링크로 왔을 때의 주소 값 (store.after 자리가 읽는다). 없으면 둘 다 null */
export type HomeMail = { mail: string | null; token: string | null };

/** 화면에 적는 주소: https://를 떼고, 이 도메인의 /<앱>이면 도메인을 붙인다 */
function shownPath(url: string, host: string | null): string {
  return /^https?:\/\//.test(url)
    ? url.replace(/^https?:\/\//, '').replace(/\/$/, '')
    : `${host ?? ''}${url}`;
}

export async function AppsHome({
  site,
  appsOrigin,
  view,
  mail = { mail: null, token: null },
}: {
  site: Site;
  /** 공통 앱 도메인의 출처. 정하지 않은 배포면 null */
  appsOrigin: string | null;
  view: 'intro' | 'apps';
  mail?: HomeMail;
}) {
  const { space, recent } = site;
  const host = hostOf(await headers());
  const shared = isAppsHost(host);
  const ordered = [...site.apps].sort((a, b) => Number(b.home) - Number(a.home));
  const apps: DeckApp[] = ordered.map((a) => ({
    slug: a.slug,
    name: a.name,
    kind: a.kind,
    description: a.description ?? '',
    href: a.url,
    path: shownPath(a.url, shared && appsOrigin ? new URL(appsOrigin).host : host),
    ownDomain: /^https?:\/\//.test(a.url),
    members: a.members,
    posts: recent
      .filter((p) => p.app?.slug === a.slug)
      .slice(0, 3)
      .map((p) => ({ title: p.title, when: p.publishedAt ? ago(p.publishedAt) : '' })),
  }));
  const news: DeckNews[] = recent.slice(0, 3).flatMap((p) =>
    p.app
      ? [
          {
            key: `${p.app.slug}/${p.slug}`,
            app: p.app.name,
            title: p.title,
            when: p.publishedAt ? ago(p.publishedAt) : '',
          },
        ]
      : [],
  );
  const joinable = joinableApps(site.apps, appsOrigin);
  const me = shared ? await serverGet<MemberMe>('/api/store/me', false, host) : null;
  const account = me?.account ?? null;
  return (
    <AppsField
      name={space.name || 'Moida'}
      logo={space.logoUrl ?? null}
      apps={apps}
      news={news}
      extra={
        apps.length > 0 && (
          <Slot
            name="store.after"
            context={{
              apps: apps.map((a) => ({ slug: a.slug, name: a.name })),
              mail: mail.mail,
              token: mail.token,
            }}
          />
        )
      }
      extraFirst={mail.mail !== null}
      loginHref={shared && joinable.length > 0 ? '/_/login' : null}
      joinHref={joinHref(joinable)}
      signedIn={
        account && me?.csrf
          ? { name: account.loginId ?? account.email ?? '내 계정', csrf: me.csrf }
          : null
      }
      initialView={mail.mail !== null ? 'apps' : view}
    />
  );
}
