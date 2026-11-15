'use client';

import Link from 'next/link';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import type { FailedEvent, FailedEventList } from '../../_platform/types';
import { when } from '../../_task/labels';

/** 멈출 때 알림이 남으므로 알림 신호로 다시 읽는다 (이 목록만의 신호는 없다) */
const TOPICS = ['platform.notification'];

/** 내용에 실린 작업 · 승인 id를 그 화면으로 잇는다 (이벤트마다 실린 값이 다르다) */
function linksOf(e: FailedEvent): { href: string; label: string }[] {
  const links: { href: string; label: string }[] = [];
  if (typeof e.data.taskId === 'string')
    links.push({ href: `/admin/tasks/${e.data.taskId}`, label: '작업' });
  if (typeof e.data.approvalId === 'string')
    links.push({ href: `/admin/approvals/${e.data.approvalId}`, label: '승인' });
  return links;
}

// 8번 실패해 일꾼이 멈춘 이벤트 (최근부터 50개). 다시 시도하면 처음처럼 받는 쪽에 다시 넘긴다.
// 요청 번호로 서버 · 일꾼 로그에서 같은 일을 찾는다.
export function FailedEventsPanel() {
  const list = useLiveValue(
    'failed-events',
    () => api<FailedEventList>('GET', '/api/events/failed'),
    TOPICS,
  );
  const action = useAction();
  const items = list.data?.items;

  const retry = (e: FailedEvent) =>
    action.run(String(e.id), () => api('POST', `/api/events/${e.id}/retry`), {
      done: `${e.topic} 다시 시도`,
      reload: list.reload,
    });

  return (
    <>
      <header className="page-head">
        <h1>처리 실패</h1>
        <button type="button" className="ghost small" onClick={() => void list.reload()}>
          새로 읽기
        </button>
      </header>
      <p className="note">
        8번 시도해도 처리하지 못해 멈춘 일. 원인을 고친 뒤 다시 시도하면 처음처럼 다시 돌아요.
      </p>
      {list.error && <p className="error">{list.error}</p>}
      {action.problem && <p className="error">{action.problem}</p>}
      {!items ? (
        !list.error && <p className="label-mono">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="rows-empty">멈춘 일 없음</p>
      ) : (
        <ul className="list">
          {items.map((e) => (
            <li key={e.id} className="list-cell failed-event">
              <div className="item-main">
                <b>{e.topic}</b>
                <small>{e.lastError ?? '–'}</small>
                <small className="label-mono">
                  {e.attempts}번 시도{e.traceId && ` · 요청 번호 ${e.traceId}`}
                  {linksOf(e).map((l) => (
                    <span key={l.href}>
                      {' · '}
                      <Link href={l.href}>{l.label}</Link>
                    </span>
                  ))}
                </small>
              </div>
              <div className="row">
                {e.failedAt && (
                  <time className="label-mono" dateTime={e.failedAt}>
                    {when(e.failedAt)}
                  </time>
                )}
                <button
                  type="button"
                  className="ghost small"
                  disabled={action.busy !== null}
                  onClick={() => void retry(e)}
                >
                  {action.busy === String(e.id) ? '보내는 중…' : '다시 시도'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
