'use client';

import Link from 'next/link';
import { AppIcon } from '../../_blog/AppIcon';
import { appPath } from '../../_blog/format';
import { APP_KIND_LABELS } from '../../_blog/labels';
import { useApps } from '../../_blog/live';
import type { AdminApp } from '../../_blog/types';
import { STORE_HREF } from '../menu';

/** 카드의 한 줄 요약: 든 것의 수 */
function summary(app: AdminApp): string {
  const c = app.counts;
  if (!c) return '';
  if (app.kind === 'page') return `페이지 ${c.pages}`;
  return [`공개 글 ${c.published}`, c.drafts > 0 ? `초안 ${c.drafts}` : '', `메뉴 ${c.menus}`]
    .filter(Boolean)
    .join(' · ');
}

// 내 앱 (스토어 1-5, 시안 1번): 만든 앱 카드를 순서대로. 공개 앱은 "열기"(공개 주소), 모든 앱은 "관리".
// 만들기는 스토어(앱 종류 고르기)에서, 대화에서도 제안 → 승인으로 만들 수 있다.
export function AppsPanel() {
  const apps = useApps();
  const list = apps.data?.apps ?? null;
  const open = list?.filter((a) => a.visibility === 'public').length ?? 0;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>내 앱</h1>
          <p>{list ? `앱 ${list.length}개 · 공개 ${open}` : '만든 앱'}</p>
        </div>
        <Link className="cta small" href={`${STORE_HREF}/new`}>
          앱 만들기
        </Link>
      </header>
      <p className="note">
        대화에서 "요리 블로그 만들어 줘"처럼 맡겨도 돼요. 제안 카드를 승인하면 비공개로 만들어져요
      </p>
      {apps.error && <p className="error">{apps.error}</p>}
      {list === null ? (
        !apps.error && <p className="label-mono">불러오는 중…</p>
      ) : list.length === 0 ? (
        <p className="rows-empty">앱 없음</p>
      ) : (
        <ul className="list" aria-label="내 앱">
          {list.map((a) => (
            <li key={a.id} className="list-cell app-row">
              <AppIcon app={a} size="small" />
              <div className="item-main">
                <b>
                  {a.name} <span className="pill">{APP_KIND_LABELS[a.kind]}</span>{' '}
                  <span className="pill">{a.visibility === 'public' ? '공개' : '비공개'}</span>
                </b>
                <small>
                  {appPath(a.slug)} · {summary(a)}
                </small>
              </div>
              <div className="row">
                {a.visibility === 'public' && (
                  <a className="ghost" href={appPath(a.slug)} target="_blank" rel="noreferrer">
                    열기
                  </a>
                )}
                <Link className="ghost" href={`${STORE_HREF}/${a.id}`}>
                  관리
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
