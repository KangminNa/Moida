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
import { AppMenus } from './AppMenus';
import { AppOverview } from './AppOverview';
import { AppPosts } from './AppPosts';
import { AppSettings } from './AppSettings';
import { AppTeamTab } from './AppTeamTab';

export type AppTab = 'overview' | 'team' | 'menus' | 'posts' | 'code' | 'settings';

const TAB_NAMES: Record<AppTab, string> = {
  overview: '개요',
  team: '운영 팀',
  menus: '메뉴',
  posts: '글',
  code: '코드',
  settings: '설정',
};

const CONFLICT = '이미 바뀐 앱이에요. 최신 내용을 다시 읽었어요';

// 앱 관리 (스토어 1-5): 머리(아이콘 · 이름 · 종류 · 주소 · 공개 전환)와 탭(개요 · 운영 팀 · 메뉴 · 글 · 코드 · 설정,
// 코드는 스토어 1-6, 운영 팀은 2단계). 공개는 관리자만 이 전환 하나로 한다 (AI · 대화는 공개를 제안하지 못한다).
export function AppPanel({ id, tab }: { id: string; tab: AppTab }) {
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
      !problem && <p className="label-mono">불러오는 중…</p>
    );

  function flip(target: AdminApp) {
    const open = target.visibility !== 'public';
    const ask = open
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
          disabled={visibility.busy !== null}
          onClick={() => flip(app)}
        >
          {open ? '비공개로 바꾸기' : '공개하기'}
        </button>
      </header>
      {problem && <p className="error">{problem}</p>}
      <nav className="row" aria-label="앱 관리">
        {(Object.keys(TAB_NAMES) as AppTab[]).map((t) => (
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
      {tab === 'team' && <AppTeamTab app={app} onChanged={apps.reload} />}
      {tab === 'menus' &&
        (app.kind === 'page' ? (
          <p className="rows-empty">페이지 앱에는 메뉴가 없음 · 첫 화면은 앱의 페이지나 앱 코드</p>
        ) : (
          <AppMenus app={app} />
        ))}
      {tab === 'posts' && <AppPosts app={app} />}
      {tab === 'code' && <AppCodeTab app={app} />}
      {tab === 'settings' && <AppSettings app={app} onChanged={apps.reload} />}
    </>
  );
}
