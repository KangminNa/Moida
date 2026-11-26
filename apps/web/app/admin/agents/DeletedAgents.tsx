'use client';

import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { engineLabel, when } from '../../_task/labels';
import { AGENT_TOPICS, useEngines } from '../../_task/live';
import type { AgentList } from '../../_task/types';

// 삭제한 에이전트 (휴지통). 작업 · 승인 기록은 그대로 남아 있고, 복원하면 다시 일을 받는다.
export function DeletedAgents({
  onRestored,
  onClose,
}: {
  /** 복원한 뒤 (에이전트 목록 다시 읽기) */
  onRestored: () => void;
  onClose: () => void;
}) {
  const deleted = useLiveValue(
    'agents:deleted',
    () => api<AgentList>('GET', '/api/agents?deleted=1'),
    AGENT_TOPICS,
  );
  const action = useAction();
  const engines = useEngines();
  const list = deleted.data?.agents;

  return (
    <section className="panel" aria-labelledby="deleted-agents">
      <div className="sec-title flat">
        <h2 id="deleted-agents">휴지통</h2>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>
      {(deleted.error ?? action.problem) && (
        <p className="error">{deleted.error ?? action.problem}</p>
      )}
      {list === undefined ? (
        !deleted.error && <p className="label-mono loading">불러오는 중…</p>
      ) : list.length === 0 ? (
        <p className="note">휴지통 비어 있음</p>
      ) : (
        <ul className="list" aria-label="삭제한 일꾼 목록">
          {list.map((a) => (
            <li key={a.id} className="item">
              <div className="item-main">
                <b>{a.name}</b>
                <small>
                  {engineLabel(engines, a.tool)} · {a.deletedAt ? `삭제 ${when(a.deletedAt)}` : ''}
                </small>
              </div>
              <button
                type="button"
                className="ghost"
                disabled={action.busy !== null}
                onClick={() =>
                  void action.run(
                    a.id,
                    () => api('POST', `/api/agents/${a.id}/restore`, { version: a.version }),
                    {
                      done: `${a.name} 복원됨`,
                      reload: async () => {
                        await deleted.reload();
                        onRestored();
                      },
                      conflict: '이미 바뀐 일꾼이에요. 최신 내용을 다시 읽었어요',
                    },
                  )
                }
              >
                복원
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
