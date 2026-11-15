'use client';

import { useEffect, useState } from 'react';
import { taskStatusLabel } from '../../_task/labels';
import { useAgents, useTasksIn } from '../../_task/live';
import type { Task } from '../../_task/types';

/** 걸린 시간을 다시 그리는 간격 */
const TICK_MS = 30_000;
/** 맡긴 사슬을 거슬러 오르는 깊이의 끝 (위임은 몇 단계뿐이라 넉넉하다) */
const MAX_DEPTH = 12;

/** 맡긴 뒤 지난 시간 */
function elapsed(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분째`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분째`;
}

/** 이 대화의 회차에서 시작한 작업인가: 맡긴 위 작업(parentId)을 거슬러 회차 작업에 닿으면 */
function inChat(task: Task, roots: ReadonlySet<string>, byId: ReadonlyMap<string, Task>): boolean {
  let at: Task | undefined = task;
  for (let depth = 0; at && depth < MAX_DEPTH; depth++) {
    if (roots.has(at.id)) return true;
    at = at.parentId ? byId.get(at.parentId) : undefined;
  }
  return false;
}

// 대화 오른쪽 칸 "팀이 동시에 일하는 중" (2026-11-15 화면 정리): 이 대화의 회차에서 시작해 아직 끝나지 않은 작업을 한 줄씩.
// 서버를 더 부르지 않고 작업 목록(대기 · 실행 · 기다림의 첫 쪽)에서 고른다. 끝나지 않은 작업의 위 작업은 늘
// 팀원을 기다리는 중이라 같은 목록에 있어 사슬을 끝까지 거슬러 오를 수 있다. 일하는 작업이 없으면 칸을 그리지 않는다.
export function ChatTeamPanel({ taskIds }: { taskIds: readonly string[] }) {
  const running = useTasksIn('running');
  const queued = useTasksIn('queued');
  const waiting = useTasksIn('waiting');
  const agents = useAgents();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // 대기에서 실행으로 넘어가는 순간에는 같은 작업이 두 목록에 있을 수 있어 나중 상태 하나만 남긴다
  const byId = new Map<string, Task>();
  for (const list of [queued, waiting, running])
    for (const t of list.data?.tasks ?? []) byId.set(t.id, t);
  const roots = new Set(taskIds);
  const lanes = [...byId.values()]
    .filter((t) => inChat(t, roots, byId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (lanes.length === 0) return null;

  const names = new Map((agents.data?.agents ?? []).map((a) => [a.id, a.name]));
  const working = lanes.filter((t) => t.status === 'running').length;
  return (
    <aside className="chat-team" aria-label="팀이 일하는 중">
      <h2>
        팀이 동시에 일하는 중 <span className="label-mono">{working}명 일하는 중</span>
      </h2>
      <ul>
        {lanes.map((t) => {
          const name = (t.agentId && names.get(t.agentId)) || '배정 기다리는 중';
          const dot =
            t.status === 'running' ? 'dot run' : t.status === 'queued' ? 'dot off' : 'dot half';
          return (
            <li key={t.id} className={t.parentId ? 'lane sub' : 'lane'}>
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
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
