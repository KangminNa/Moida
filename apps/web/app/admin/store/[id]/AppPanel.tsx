'use client';

import Link from 'next/link';
import { AppIcon } from '../../../_blog/AppIcon';
import { appPath } from '../../../_blog/format';
import { APP_KIND_LABELS } from '../../../_blog/labels';
import { useApps } from '../../../_blog/live';
import type { AdminApp } from '../../../_blog/types';
import { api } from '../../../_lib/client-api';
import { useAction } from '../../../_lib/use-action';
import { NewTabLink } from '../../../_ui/NewTabLink';
import { STORE_HREF } from '../../menu';
import { AppCodeTab } from './AppCodeTab';
import { AppCommunityTab } from './AppCommunityTab';
import { AppDataTab } from './AppDataTab';
import { AppMenus } from './AppMenus';
import { AppOverview } from './AppOverview';
import { AppPosts } from './AppPosts';
import { AppSettings } from './AppSettings';
import { CommunityMembers } from './CommunityMembers';
import { CommunityTerms } from './CommunityTerms';

export type AppTab =
  | 'overview'
  | 'community'
  | 'members'
  | 'menus'
  | 'posts'
  | 'code'
  | 'data'
  | 'settings';

const TAB_NAMES: Record<AppTab, string> = {
  overview: '개요',
  community: '커뮤니티',
  members: '회원',
  menus: '메뉴',
  posts: '글',
  code: '코드',
  data: '데이터',
  settings: '설정',
};

/** 앱 종류마다의 탭: 커뮤니티(스토어 3-2)는 블로그 글 · 메뉴 대신 커뮤니티 탭 */
const BLOG_TABS: readonly AppTab[] = ['overview', 'menus', 'posts', 'code', 'data', 'settings'];
const TABS_OF: Record<AdminApp['kind'], readonly AppTab[]> = {
  blog: BLOG_TABS,
  magazine: BLOG_TABS,
  page: ['overview', 'members', 'menus', 'posts', 'code', 'data', 'settings'],
  community: ['overview', 'community', 'code', 'data', 'settings'],
};

/** 이 앱에 보일 탭: 회원 탭은 회원을 받는 페이지 앱에만 (커뮤니티의 회원은 커뮤니티 탭 안에 있다, 스토어 12.3) */
function tabsOf(app: AdminApp): readonly AppTab[] {
  return TABS_OF[app.kind].filter((t) => t !== 'members' || app.members);
}

const CONFLICT = '이미 바뀐 앱이에요. 최신 내용을 다시 읽었어요';

// 앱 관리 (스토어 1-5): 머리(아이콘 · 이름 · 종류 · 주소 · 공개 전환)와 탭(개요 · 메뉴 · 글 · 코드 · 설정,
// 코드는 스토어 1-6, 커뮤니티 앱은 메뉴 · 글 대신 커뮤니티 탭: 3-2). 운영 팀 탭은 없다 (2026-11-21: 맡기기는 개요, 편집 방침은 설정).
// 공개는 관리자만 이 전환 하나로 한다 (AI · 대화는 공개를 제안하지 못한다).
export function AppPanel({ id, tab: asked }: { id: string; tab: AppTab }) {
  const apps = useApps();
  const visibility = useAction();
  const app = apps.data?.apps.find((a) => a.id === id) ?? null;
  const problem = visibility.problem ?? apps.error;

  if (!app)
    return apps.data ? (
      <p className="rows-empty">
        없는 앱 · <Link href={STORE_HREF}>내 앱</Link>
      </p>
    ) : (
      !problem && <p className="label-mono loading">불러오는 중…</p>
    );

  const tabs = tabsOf(app);
  const tab = tabs.includes(asked) ? asked : 'overview';
  const community = app.kind === 'community';
  /** 커뮤니티는 연결을 확인한 도메인이 있어야 공개된다 (스토어 3-2, 서버 App.edit) */
  const needsDomain = community && app.visibility !== 'public' && !app.domainCheckedAt;

  function flip(target: AdminApp) {
    const open = target.visibility !== 'public';
    const ask = community
      ? open
        ? `${target.name}을(를) 공개할까요? 방문자가 앱 도메인에서 가입하고 글 · 댓글을 쓸 수 있어요`
        : `${target.name}을(를) 비공개로 바꿀까요? 회원 · 글은 남고 방문자에게서 사라져요`
      : open
        ? `${target.name}을(를) 공개할까요? 방문자에게 이 앱과 앱의 공개 글이 보여요`
        : `${target.name}을(를) 비공개로 바꿀까요? 앱의 글 · 메뉴 · 호가 방문자에게서 사라져요`;
    if (!window.confirm(ask)) return;
    void visibility.run(
      'visibility',
      () =>
        api('PATCH', `/api/apps/${target.id}`, {
          version: target.version,
          visibility: open ? 'public' : 'private',
        }),
      { done: open ? '공개함' : '비공개로 바꿈', reload: apps.reload, conflict: CONFLICT },
    );
  }

  const open = app.visibility === 'public';
  return (
    <>
      <p>
        <Link className="ghost small" href={STORE_HREF}>
          ← 내 앱
        </Link>
      </p>
      <header className="page-head app-head">
        <AppIcon app={app} size="small" />
        <div>
          <h1>{app.name}</h1>
          <p>
            {APP_KIND_LABELS[app.kind]} ·{' '}
            {open ? (
              <NewTabLink href={app.url}>{app.url}</NewTabLink>
            ) : (
              `${appPath(app.slug)} (비공개: 방문자에게 없는 주소)`
            )}
          </p>
        </div>
        <button
          type="button"
          className={open ? 'ghost small' : 'cta small'}
          disabled={visibility.busy !== null || needsDomain}
          onClick={() => flip(app)}
        >
          {open ? '비공개로 바꾸기' : '공개하기'}
        </button>
      </header>
      {needsDomain && (
        <p className="note">
          커뮤니티는 회원 가입 · 글쓰기가 앱 도메인에서만 돼요.{' '}
          <Link href={`${STORE_HREF}/${app.id}?tab=settings`}>설정</Link>에서 도메인을 연결하고
          확인하면 공개할 수 있어요
        </p>
      )}
      {problem && <p className="error">{problem}</p>}
      <nav className="row" aria-label="앱 관리">
        {tabs.map((t) => (
          <Link
            key={t}
            className="chip"
            href={`${STORE_HREF}/${app.id}?tab=${t}`}
            aria-current={t === tab ? 'true' : undefined}
          >
            {TAB_NAMES[t]}
          </Link>
        ))}
      </nav>
      {tab === 'overview' && <AppOverview app={app} />}
      {tab === 'community' && <AppCommunityTab app={app} />}
      {tab === 'menus' &&
        (app.kind === 'page' ? (
          <p className="rows-empty">페이지 앱에는 메뉴가 없음 · 첫 화면은 앱의 페이지나 앱 코드</p>
        ) : (
          <AppMenus app={app} />
        ))}
      {tab === 'posts' && <AppPosts app={app} />}
      {tab === 'members' && (
        <>
          <CommunityTerms appId={app.id} />
          <CommunityMembers appId={app.id} />
        </>
      )}
      {tab === 'code' && <AppCodeTab app={app} />}
      {tab === 'data' && <AppDataTab app={app} />}
      {tab === 'settings' && <AppSettings app={app} onChanged={apps.reload} />}
    </>
  );
}
