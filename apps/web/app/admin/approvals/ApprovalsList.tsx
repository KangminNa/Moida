'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect, useRef } from 'react';
import { useLiveValue } from '../../_lib/use-live';
import { APPROVAL_STATUS, actionLabel, when } from '../../_task/labels';
import { APPROVAL_TOPICS, countOf, readPages, useAgents } from '../../_task/live';
import { ApprovalPill } from '../../_task/parts';
import type { ApprovalPage } from '../../_task/types';
import { useWaitingChanges } from '../../_vault/live';
import { ApprovalBoard } from './ApprovalBoard';
import { WikiProposals } from './WikiProposals';

const ALL = 'all';
/** 칸반 (2026-11-24): 승인 대기를 할 일로 나눈 열. 승인 화면을 열면 처음 보인다 */
const BOARD = 'board';
const DEFAULT = BOARD;
/** 위키 제안: 작업 승인이 아니라 vault의 검토 대기 변경이다 */
const WIKI = 'wiki';
const FILTERS: readonly string[] = [...Object.keys(APPROVAL_STATUS), ALL];
/** 목록과 내용을 나란히 놓는 폭 (globals.css의 .split과 맞춘다) */
const SIDE_BY_SIDE = '(min-width: 1041px)';

function mergePages(before: ApprovalPage, more: ApprovalPage): ApprovalPage {
  return { ...more, approvals: [...before.approvals, ...more.approvals] };
}

// 승인: 상태 칩 + 왼쪽 목록(기본은 대기) + 오른쪽 내용. 마지막 칩은 AI의 위키 제안이다.
export function ApprovalsList({ children }: { children: ReactNode }) {
  const asked = useSearchParams().get('status');
  const filter = asked === WIKI || (asked && FILTERS.includes(asked)) ? asked : DEFAULT;
  const { id } = useParams<{ id?: string }>();
  const waiting = useWaitingChanges();

  return (
    <>
      <nav className="chips" aria-label="승인 상태">
        <Link
          className="chip"
          href="/admin/approvals"
          aria-current={filter === BOARD ? 'true' : undefined}
        >
          칸반
        </Link>
        {FILTERS.map((s) => (
          <Link
            key={s}
            className="chip"
            href={`/admin/approvals?status=${s}`}
            aria-current={filter === s ? 'true' : undefined}
          >
            {APPROVAL_STATUS[s] ?? '전체'}
          </Link>
        ))}
        <Link
          className="chip"
          href={`/admin/approvals?status=${WIKI}`}
          aria-current={filter === WIKI ? 'true' : undefined}
        >
          위키 제안 {countOf(waiting.data?.changes, waiting.data?.next)}
        </Link>
      </nav>
      {filter === WIKI ? (
        <WikiProposals />
      ) : filter === BOARD ? (
        id ? (
          <div className="split-detail">
            <Link className="ghost" style={{ alignSelf: 'flex-start' }} href="/admin/approvals">
              칸반
            </Link>
            {children}
          </div>
        ) : (
          <ApprovalBoard />
        )
      ) : (
        <TaskApprovals filter={filter}>{children}</TaskApprovals>
      )}
    </>
  );
}

// 좁은 화면에서는 고르기 전에 목록, 고른 뒤에 내용만 보인다.
function TaskApprovals({ filter, children }: { filter: string; children: ReactNode }) {
  const { id } = useParams<{ id?: string }>();
  const router = useRouter();
  const query = `?status=${filter}`;
  const pages = useRef(1);
  const seen = useRef(filter);
  if (seen.current !== filter) {
    seen.current = filter;
    pages.current = 1;
  }
  const list = useLiveValue(
    `approvals:${filter}`,
    () =>
      readPages(
        filter === ALL ? '/api/approvals' : `/api/approvals?status=${filter}`,
        pages.current,
        mergePages,
      ),
    APPROVAL_TOPICS,
  );
  const agents = useAgents();
  const nameOf = (agentId: string | null) =>
    agents.data?.agents.find((a) => a.id === agentId)?.name ?? '서버';

  // 고른 승인을 주소로 고정한다: 신호로 목록이 바뀌어도 읽던 승인이 다른 승인으로 바뀌지 않게
  const first = list.data?.approvals[0]?.id;
  useEffect(() => {
    if (!id && first && window.matchMedia(SIDE_BY_SIDE).matches)
      router.replace(`/admin/approvals/${first}${query}`);
  }, [id, first, query, router]);

  const empty = list.data?.approvals.length === 0;

  return (
    <>
      {list.error && <p className="error">{list.error}</p>}
      <div className={id ? 'split picked' : 'split'}>
        <div className="split-list">
          {list.data === null ? (
            !list.error && <p className="label-mono">불러오는 중…</p>
          ) : empty ? (
            <p className="rows-empty">
              {filter === ALL ? '승인 없음' : `${APPROVAL_STATUS[filter]} 승인 없음`}
            </p>
          ) : (
            <ul className="list">
              {list.data.approvals.map((a) => (
                <li key={a.id}>
                  <Link
                    className="item"
                    href={`/admin/approvals/${a.id}${query}`}
                    aria-current={a.id === id ? 'true' : undefined}
                  >
                    <div className="item-main">
                      <b>{actionLabel(a.action)}</b>
                      <small>
                        {nameOf(a.agentId)} · {when(a.createdAt)}
                      </small>
                    </div>
                    <ApprovalPill status={a.status} />
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
        </div>
        <div className="split-detail">
          {id && (
            <Link className="ghost split-back" href={`/admin/approvals${query}`}>
              승인 목록
            </Link>
          )}
          {children}
        </div>
      </div>
    </>
  );
}
