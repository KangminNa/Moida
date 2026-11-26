'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { usePicks } from '../../_lib/use-picks';
import { TASK_STATUS, when } from '../../_task/labels';
import { readPages, TASK_LOG_TOPICS } from '../../_task/live';
import { TaskPill } from '../../_task/parts';
import type { Agent, TaskPage, TaskTrashed } from '../../_task/types';

/** 작업 기록의 휴지통 (2026-11-23): 상태 대신 이 값으로 연다 (?status=trash) */
export const TRASH = 'trash';
/** 휴지통에 넣을 수 있는 상태 (서버 tasks_trash_finished와 같다) */
const FINISHED = ['done', 'failed', 'cancelled'];
/** 한 번에 보낼 수 있는 수 (서버 TaskTrashInput.MAX) */
const MAX = 200;

function mergePages(before: TaskPage, more: TaskPage): TaskPage {
  return { ...more, tasks: [...before.tasks, ...more.tasks] };
}

// 상태별 작업 목록. 끝난 상태와 휴지통에서는 여럿 골라 휴지통으로 보내거나 꺼낸다 (2026-11-23 일괄 지우기).
// 휴지통은 작업 기록 목록에서만 빼는 것이다: 실행 기록 · 결과물 · 대화의 회차는 그대로 남는다.
// 거르는 상태마다 따로 둔다: 바꾸면 읽은 쪽 수가 처음으로 돌아간다
export function TaskList({ filter, agents }: { filter: string; agents: readonly Agent[] }) {
  const trash = filter === TRASH;
  const path = trash ? '/api/tasks?trash=1' : `/api/tasks?status=${filter}`;
  const pages = useRef(1);
  const list = useLiveValue(
    `tasks:${filter}`,
    () => readPages(path, pages.current, mergePages),
    TASK_LOG_TOPICS,
  );
  const picks = usePicks();
  const action = useAction();
  const nameOf = (id: string | null) => agents.find((a) => a.id === id)?.name ?? '자동 배정';
  const pickable = trash || FINISHED.includes(filter);
  const tasks = list.data?.tasks ?? [];

  function send() {
    const ids = [...picks.picked];
    if (
      !trash &&
      !window.confirm(
        `${ids.length}개를 작업 기록에서 휴지통으로 보낼까요? 휴지통에서 꺼낼 수 있어요`,
      )
    )
      return;
    void action.run(
      'picked',
      () => api<TaskTrashed>('POST', trash ? '/api/tasks/restore' : '/api/tasks/trash', { ids }),
      {
        done: (d) => (trash ? `${d.count}개 꺼냄` : `${d.count}개 휴지통으로`),
        reload: () => {
          picks.clear();
          return list.reload();
        },
      },
    );
  }

  return (
    <>
      {list.error && <p className="error">{list.error}</p>}
      {action.problem && <p className="error">{action.problem}</p>}
      {pickable && tasks.length > 0 && (
        <div className="row">
          <button
            type="button"
            className="ghost small"
            onClick={() =>
              picks.size === tasks.length ? picks.clear() : picks.all(tasks.map((t) => t.id))
            }
          >
            {picks.size === tasks.length ? '고르기 풀기' : '보이는 것 모두 고르기'}
          </button>
          {picks.size > 0 && (
            <button
              type="button"
              className="ghost small"
              disabled={action.busy !== null || picks.size > MAX}
              onClick={send}
            >
              {trash ? `고른 ${picks.size}개 꺼내기` : `고른 ${picks.size}개 휴지통으로`}
            </button>
          )}
          {picks.size > MAX && <small className="note">한 번에 {MAX}개까지</small>}
        </div>
      )}
      {list.data === null ? (
        !list.error && <p className="label-mono loading">불러오는 중…</p>
      ) : tasks.length === 0 ? (
        <p className="rows-empty">
          {trash ? '휴지통이 비었어요' : `${TASK_STATUS[filter]} 작업 없음`}
        </p>
      ) : (
        <ul className="list">
          {tasks.map((t) => (
            <li key={t.id} className={pickable ? 'pick-row' : undefined}>
              {pickable && (
                <input
                  type="checkbox"
                  aria-label={`${t.title} 고르기`}
                  checked={picks.has(t.id)}
                  onChange={() => picks.toggle(t.id)}
                />
              )}
              <Link className="item" href={`/admin/tasks/${t.id}`}>
                <div className="item-main">
                  <b>{t.title}</b>
                  <small>
                    {nameOf(t.agentId)} · {when(t.createdAt)}
                  </small>
                </div>
                <TaskPill status={t.status} waitReason={t.waitReason} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {list.data?.next && (
        <button
          type="button"
          className="ghost wide"
          onClick={() => {
            pages.current += 1;
            void list.reload();
          }}
        >
          더 보기
        </button>
      )}
    </>
  );
}
