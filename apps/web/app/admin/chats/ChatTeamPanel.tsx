'use client';

import { useEffect, useState } from 'react';
import { elapsed, remaining, taskStatusLabel } from '../../_task/labels';
import type { ChatTeamMember } from '../../_task/types';

/** 걸린 시간을 다시 그리는 간격 */
const TICK_MS = 30_000;

// 대화 오른쪽 칸 "일꾼이 동시에 일하는 중" (2026-11-15 화면 정리): 이 대화의 회차 · 덧붙인 말의 답 · 검토와 그 아래에서
// 끝나지 않은 작업을 한 줄씩. 고르는 것은 서버(ChatQuery.team)가 하고 여기서는 그리기만 한다. 대화를 다시 읽을 때 함께 온다.
// 일하는 작업이 없으면 칸을 그리지 않는다.
// 일꾼을 기다리는 줄(일꾼 기다리기, 2026-11-19)에는 기한(지나면 다 끝나지 않아도 깬다)과 "지금까지로 답하기"가 있다.
// 누르는 동작은 패널(ChatThreadPanel)이 돌리고 여기서는 부른다
export function ChatTeamPanel({
  team,
  busy,
  problem,
  onHurry,
}: {
  team: readonly ChatTeamMember[];
  /** 지금 누르고 있는 줄의 동작 이름 (hurry:<작업>) */
  busy: string | null;
  problem: string | null;
  onHurry: (taskId: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  if (team.length === 0) return null;

  const working = team.filter((t) => t.status === 'running').length;
  return (
    <aside className="chat-team" aria-label="일꾼이 일하는 중">
      <h2>
        일꾼이 동시에 일하는 중 <span className="label-mono">{working}명 일하는 중</span>
      </h2>
      <ul>
        {team.map((t) => {
          const name = t.agent ?? '배정 기다리는 중';
          const dot =
            t.status === 'running' ? 'dot run' : t.status === 'queued' ? 'dot off' : 'dot half';
          return (
            <li key={t.taskId} className={t.parentId ? 'lane sub' : 'lane'}>
              <span className="agent-mark">{name.slice(0, 1)}</span>
              <div className="item-main">
                <p className="lane-top">
                  <strong className="clamp-1">{name}</strong>
                  <span className="label-mono">{elapsed(t.createdAt, now)}</span>
                </p>
                <p className="clamp-1">{t.title}</p>
                <p className="lane-state">
                  <span className={dot} />
                  {taskStatusLabel(t.status, t.waitReason)}
                </p>
                {t.lastEvent && <p className="lane-event">{t.lastEvent}</p>}
                {t.status === 'waiting' && t.waitReason === 'subtasks' && (
                  <p className="lane-wait">
                    {t.waitUntil && (
                      <span className="label-mono">{remaining(t.waitUntil, now)}</span>
                    )}
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy !== null}
                      onClick={() => onHurry(t.taskId)}
                    >
                      {busy === `hurry:${t.taskId}` ? '깨우는 중…' : '지금까지로 답하기'}
                    </button>
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {problem && <p className="error">{problem}</p>}
    </aside>
  );
}
