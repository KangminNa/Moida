'use client';

import { api, describe } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { useNotify } from '../../_ui/notify';
import type { SessionTrash, TrashedSession } from '../../_vault/types';
import { SESSION_TOPICS, when } from './SessionPanel';

// 세션 휴지통 (2026-11-19 휴지통 A): 넣은 때가 늦은 순. 복원하면 버전 · 원문 · 대표 위키가 그대로 돌아온다.
// 지우지 않는다 (휴지통에 있는 동안 같은 대화가 다시 올라와도 여기에 남는다)
export function SessionTrashPanel() {
  const notify = useNotify();
  const action = useAction();
  const trash = useLiveValue(
    'session-trash',
    () => api<SessionTrash>('GET', '/api/sessions/trash'),
    SESSION_TOPICS,
  );

  async function restore(session: TrashedSession) {
    const send = () =>
      api('POST', `/api/sessions/${session.id}/restore`, { version: session.version });
    const plan = { done: `${session.title || '제목 없음'} 복원됨`, reload: trash.reload };
    const reply = await action.run(session.id, send, plan);
    if (reply && !reply.ok) notify(describe(reply.error));
  }

  if (trash.error) return <p className="error">{trash.error}</p>;
  if (trash.data === null) return <p className="label-mono loading">불러오는 중…</p>;
  if (trash.data.sessions.length === 0) return <p className="rows-empty">휴지통 비어 있음</p>;
  return (
    <>
      <p className="note">복원하면 버전 · 원문 · 대표 위키가 그대로 돌아와요</p>
      <ul className="list" aria-label="세션 휴지통">
        {trash.data.sessions.map((s) => (
          <li key={s.id} className="item">
            <div className="item-main">
              <b>{s.title || '제목 없음'}</b>
              <small>
                {[s.project ?? '프로젝트 없음', s.tool, `휴지통으로 ${when(s.trashedAt)}`].join(
                  ' · ',
                )}
              </small>
            </div>
            <button
              type="button"
              className="ghost"
              disabled={action.busy !== null}
              onClick={() => restore(s)}
            >
              복원
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
