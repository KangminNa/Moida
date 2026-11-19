'use client';

import { api, describe } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { CHAT_LIST_TOPICS } from '../../_task/live';
import type { ChatTrash, TrashedChat } from '../../_task/types';
import { useNotify } from '../../_ui/notify';

function when(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

// 대화 휴지통 (2026-11-19 휴지통 A): 넣은 때가 늦은 순. 복원하면 회차 · 결과물 · 소식이 그대로 돌아오고,
// 휴지통으로 보낼 때 멈춘 일은 다시 돌지 않는다 (다음 메시지부터 이어서)
export function ChatTrashPanel() {
  const notify = useNotify();
  const action = useAction();
  const trash = useLiveValue(
    'chat-trash',
    () => api<ChatTrash>('GET', '/api/chats/trash'),
    CHAT_LIST_TOPICS,
  );

  async function restore(chat: TrashedChat) {
    const send = () => api('POST', `/api/chats/${chat.id}/restore`, { version: chat.version });
    const plan = { done: `${chat.title} 복원됨`, reload: trash.reload };
    const reply = await action.run(chat.id, send, plan);
    if (reply && !reply.ok) notify(describe(reply.error));
  }

  if (trash.error) return <p className="error">{trash.error}</p>;
  if (trash.data === null) return <p className="label-mono">불러오는 중…</p>;
  if (trash.data.chats.length === 0) return <p className="rows-empty">휴지통 비어 있음</p>;
  return (
    <>
      <p className="note">
        복원하면 회차 · 결과물 · 소식이 그대로 돌아와요. 멈춘 일은 다시 돌지 않아요
      </p>
      <ul className="list" aria-label="대화 휴지통">
        {trash.data.chats.map((c) => (
          <li key={c.id} className="item">
            <div className="item-main">
              <b>{c.title}</b>
              <small>{`회차 ${c.turns} · 휴지통으로 ${when(c.trashedAt)}`}</small>
            </div>
            <button
              type="button"
              className="ghost"
              disabled={action.busy !== null}
              onClick={() => restore(c)}
            >
              복원
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
