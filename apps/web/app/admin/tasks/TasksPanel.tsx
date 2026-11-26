'use client';

import Link from 'next/link';
import { type ApiReply, api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { AskForm } from '../../_task/AskForm';
import { TASK_STATUS, when } from '../../_task/labels';
import { countOf, TASK_LOG_TOPICS, useAgents } from '../../_task/live';
import { TaskPill } from '../../_task/parts';
import type { Agent, Task, TaskPage, TaskTrashed } from '../../_task/types';
import { useNotify } from '../../_ui/notify';
import { TaskList, TRASH } from './TaskList';

/** 보드의 칸. 끝난 작업은 완료 칸에 모은다 */
const COLUMNS = [
  { name: '대기', statuses: ['queued'] },
  { name: '실행 중', statuses: ['running'] },
  { name: '승인 대기', statuses: ['waiting'] },
  { name: '완료', statuses: ['done', 'failed', 'cancelled'] },
];
/** 칸에 펼쳐 두는 수. 나머지는 상태별 목록에서 본다 */
const SHOWN = 10;

type Board = Record<string, TaskPage>;

async function readBoard(): Promise<ApiReply<Board>> {
  const statuses = COLUMNS.flatMap((c) => c.statuses);
  const replies = await Promise.all(
    statuses.map((s) => api<TaskPage>('GET', `/api/tasks?status=${s}`)),
  );
  const board: Board = {};
  for (const [i, reply] of replies.entries()) {
    if (!reply.ok) return reply;
    board[statuses[i] as string] = reply.data;
  }
  return { ok: true, data: board };
}

// 작업: 입력과 보드. 칸 머리를 누르면 상태별 목록, 카드를 누르면 상세(/admin/tasks/<id>)로.
export function TasksPanel({ status, ask }: { status: string | null; ask: boolean }) {
  const notify = useNotify();
  const agents = useAgents();
  const filter = status && (status in TASK_STATUS || status === TRASH) ? status : null;
  const list = agents.data?.agents ?? [];

  return (
    <>
      <AskForm
        agents={agents.data?.agents ?? null}
        focus={ask}
        onCreated={() => notify('작업 등록됨')}
      />
      {filter ? (
        <>
          <nav className="chips" aria-label="작업 상태">
            <Link className="chip" href="/admin/tasks">
              보드
            </Link>
            {Object.keys(TASK_STATUS).map((s) => (
              <Link
                key={s}
                className="chip"
                href={`/admin/tasks?status=${s}`}
                aria-current={filter === s ? 'true' : undefined}
              >
                {TASK_STATUS[s]}
              </Link>
            ))}
            <Link
              className="chip"
              href={`/admin/tasks?status=${TRASH}`}
              aria-current={filter === TRASH ? 'true' : undefined}
            >
              휴지통
            </Link>
          </nav>
          <TaskList key={filter} filter={filter} agents={list} />
        </>
      ) : (
        <TaskBoard agents={list} />
      )}
    </>
  );
}

function TaskBoard({ agents }: { agents: readonly Agent[] }) {
  const board = useLiveValue('tasks:board', readBoard, TASK_LOG_TOPICS);
  const nameOf = (id: string | null) => agents.find((a) => a.id === id)?.name;
  const clear = useAction();

  /** 끝난 작업(완료 · 실패 · 취소) 모두를 작업 기록의 휴지통으로 (2026-11-23 일괄 지우기) */
  function clearFinished() {
    if (
      !window.confirm(
        '끝난 작업(완료 · 실패 · 취소)을 모두 작업 기록에서 휴지통으로 보낼까요? 휴지통에서 꺼낼 수 있어요',
      )
    )
      return;
    void clear.run(
      'finished',
      () => api<TaskTrashed>('POST', '/api/tasks/trash', { finished: true }),
      { done: (d) => `${d.count}개 휴지통으로`, reload: board.reload },
    );
  }

  if (board.data === null)
    return board.error ? (
      <p className="error">{board.error}</p>
    ) : (
      <p className="label-mono loading">불러오는 중…</p>
    );
  const pages = board.data;

  return (
    <>
      {board.error && <p className="error">{board.error}</p>}
      {clear.problem && <p className="error">{clear.problem}</p>}
      <div className="row">
        <button
          type="button"
          className="ghost small"
          disabled={clear.busy !== null}
          onClick={clearFinished}
        >
          끝난 작업 모두 휴지통으로
        </button>
        <Link className="ghost small" href={`/admin/tasks?status=${TRASH}`}>
          휴지통
        </Link>
      </div>
      <div className="board">
        {COLUMNS.map((column) => {
          const shown = column.statuses.map((s) => pages[s]);
          const tasks = shown.flatMap((p) => p?.tasks ?? []).sort((a, b) => (a.id < b.id ? 1 : -1));
          const more = shown.find((p) => p?.next)?.next;
          return (
            <section key={column.name} className="col" aria-label={column.name}>
              <Link className="col-head" href={`/admin/tasks?status=${column.statuses[0]}`}>
                <span>{column.name}</span>
                <span>{countOf(tasks, more)}</span>
              </Link>
              {tasks.length === 0 ? (
                <p className="rows-empty">없음</p>
              ) : (
                tasks
                  .slice(0, SHOWN)
                  .map((t) => <TaskCard key={t.id} task={t} agent={nameOf(t.agentId)} />)
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function TaskCard({ task, agent }: { task: Task; agent: string | undefined }) {
  // 끝난 상태와, 승인이 아니라 하위 작업을 기다리는 카드는 상태를 따로 보인다
  const marked =
    task.status === 'failed' || task.status === 'cancelled' || task.waitReason === 'subtasks';
  return (
    <Link
      className={task.status === 'waiting' ? 't-card wait' : 't-card'}
      href={`/admin/tasks/${task.id}`}
    >
      <b>{task.title}</b>
      <span className="t-who">
        {task.status === 'running' && <span className="dot run" aria-hidden="true" />}
        {agent ?? '자동 배정'}
      </span>
      <small>
        {task.lastEvent ?? (task.status === 'queued' ? '러너 배정 대기' : when(task.createdAt))}
      </small>
      {marked && <TaskPill status={task.status} waitReason={task.waitReason} />}
    </Link>
  );
}
