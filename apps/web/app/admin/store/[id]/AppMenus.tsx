'use client';

import Link from 'next/link';
import { useState } from 'react';
import { menuPath } from '../../../_blog/format';
import { MENU_KIND_LABELS } from '../../../_blog/labels';
import { useMenus } from '../../../_blog/live';
import type { AdminApp, Menu } from '../../../_blog/types';
import { api } from '../../../_lib/client-api';
import { useAction } from '../../../_lib/use-action';
import { NewTabLink } from '../../../_ui/NewTabLink';
import { STORE_HREF } from '../../menu';
import { type MenuBody, MenuForm } from './MenuForm';

const NEW = 'new';
const CONFLICT = '이미 바뀐 메뉴예요. 최신 내용을 다시 읽었어요';

// 앱의 메뉴 (2차 6단계 블로그 메뉴를 스토어 1-5에서 앱 관리로 옮김): 앱 머리의 메뉴 줄 순서대로. 추가 · 편집 · 삭제(빈 메뉴만).
// 메뉴는 이 앱에 만들어진다 (appId). 글 · 페이지는 보관함에서 "메뉴에 올리기"로 담는다.
export function AppMenus({ app }: { app: AdminApp }) {
  const menus = useMenus(app.slug);
  const action = useAction();
  const save = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const list = menus.data?.menus ?? null;
  const problem = action.problem ?? menus.error;

  function close() {
    setOpen(null);
    save.clear();
  }

  async function submit(target: Menu | null, body: MenuBody, requestId: string) {
    const reply = await save.run(
      'save',
      () =>
        target
          ? api('PATCH', `/api/menus/${target.id}`, { ...body, version: target.version })
          : api('POST', '/api/menus', { ...body, appId: app.id, requestId }),
      { done: `${body.name} 저장됨`, reload: menus.reload, conflict: CONFLICT },
    );
    if (reply?.ok) setOpen(null);
    return reply?.ok === true;
  }

  function remove(menu: Menu) {
    if (!window.confirm(`${menu.name} 메뉴를 지울까요?`)) return;
    void action.run(
      menu.id,
      () => api('POST', `/api/menus/${menu.id}/delete`, { version: menu.version }),
      { done: `${menu.name} 삭제`, reload: menus.reload, conflict: CONFLICT },
    );
  }

  const form = (menu: Menu | null) => (
    <MenuForm
      key={menu?.version ?? NEW}
      menu={menu}
      busy={save.busy !== null}
      problem={save.problem}
      onSubmit={(body, requestId) => submit(menu, body, requestId)}
      onEdit={save.clear}
      onClose={close}
    />
  );

  return (
    <>
      <header className="page-head">
        <div>
          <h2>메뉴</h2>
          <p>앱 머리의 메뉴 줄. 글 · 페이지는 보관함에서 메뉴에 올림</p>
        </div>
        {open !== NEW && (
          <button type="button" className="cta small" onClick={() => setOpen(NEW)}>
            메뉴 추가
          </button>
        )}
      </header>
      {problem && <p className="error">{problem}</p>}
      {open === NEW && form(null)}
      {list === null ? (
        !problem && <p className="label-mono">불러오는 중…</p>
      ) : list.length === 0 ? (
        <p className="rows-empty">메뉴 없음</p>
      ) : (
        <ul className="list" aria-label="메뉴">
          {list.map((m) =>
            open === m.id ? (
              <li key={m.id} className="list-cell">
                {form(m)}
              </li>
            ) : (
              <li key={m.id} className="list-cell schedule-row">
                <div className="item-main">
                  <b>
                    {m.name} <span className="pill">{MENU_KIND_LABELS[m.kind] ?? m.kind}</span>
                  </b>
                  <small>
                    <NewTabLink href={menuPath(m.slug, app.slug)}>
                      /{app.slug}/m/{m.slug}
                    </NewTabLink>{' '}
                    · {m.items ?? 0}개{m.rss && m.kind === 'posts' ? ' · RSS' : ''}
                  </small>
                  {m.policy && <small className="clamp">{m.policy}</small>}
                </div>
                <div className="row">
                  {m.kind === 'issues' && (
                    <Link className="ghost" href={`${STORE_HREF}/${app.id}/m/${m.id}`}>
                      호 관리
                    </Link>
                  )}
                  <button type="button" className="ghost" onClick={() => setOpen(m.id)}>
                    편집
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={action.busy === m.id}
                    onClick={() => remove(m)}
                  >
                    삭제
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </>
  );
}
