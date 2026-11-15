'use client';

import Link from 'next/link';
import { useState } from 'react';
import { menuPath } from '../../_blog/format';
import { MENU_KIND_LABELS } from '../../_blog/labels';
import type { Menu, MenuList } from '../../_blog/types';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { useAgents } from '../../_task/live';
import { type MenuBody, MenuForm } from './MenuForm';

const NEW = 'new';
const CONFLICT = '이미 바뀐 메뉴예요. 최신 내용을 다시 읽었어요';

// 블로그 메뉴 (2차 6단계): 공개 블로그 위쪽 메뉴 줄의 순서대로. 추가 · 편집 · 삭제(빈 메뉴만).
// 글 · 페이지는 보관함에서 "메뉴에 올리기"로 담는다.
export function MenusPanel() {
  const menus = useLiveValue('menus', () => api<MenuList>('GET', '/api/menus'), []);
  const agents = useAgents();
  const action = useAction();
  const save = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const list = menus.data?.menus ?? null;
  const agentList = agents.data?.agents ?? [];
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
          : api('POST', '/api/menus', { ...body, requestId }),
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
      agents={agentList}
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
          <h1>블로그 메뉴</h1>
          <p>공개 블로그 위쪽 메뉴 줄. 글 · 페이지는 보관함에서 메뉴에 올림</p>
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
                    <a href={menuPath(m.slug)} target="_blank" rel="noreferrer">
                      {menuPath(m.slug)}
                    </a>{' '}
                    · {m.items ?? 0}개 · 운영 팀{' '}
                    {agentList.find((a) => a.id === m.agentId)?.name ?? '없음'}
                    {m.rss && m.kind === 'posts' ? ' · RSS' : ''}
                  </small>
                  {m.policy && <small className="clamp">{m.policy}</small>}
                </div>
                <div className="row">
                  {m.kind === 'issues' && (
                    <Link className="ghost" href={`/admin/menus/${m.id}`}>
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
