'use client';

import Link from 'next/link';
import { ago } from '../../_lib/time-ago';
import { useLiveValue } from '../../_lib/use-live';
import {
  actionLabel,
  CALL_API,
  GOAL_COMPLETE,
  GOAL_CONTINUE,
  LOGIN_SITE,
  MERGE_PULL,
  PLUG_API,
  PLUG_TOOL,
  PUBLISH_POST,
  PUBLISH_SITE,
  RAISE_LIMIT,
  SETTING_CHANGE,
  SHOW_APP_CODE,
  START_CODE,
} from '../../_task/labels';
import { APPROVAL_TOPICS, readPages, useAgents } from '../../_task/live';
import { SETTING_NAMES } from '../../_task/setting-labels';
import type { Approval, ApprovalPage } from '../../_task/types';

/** 대기 승인을 몇 쪽까지 읽는지 (한 쪽 30개) */
const PAGES = 4;
/** 대화의 결과 카드 (서버 Approval.CARD) */
const CHAT_RESULT = 'task.chat.result';
/** 매거진 호 발행 (서버 blog.issue.publish) */
const PUBLISH_ISSUE = 'blog.issue.publish';

/**
 * 칸반의 열: 승인할 때 관리자가 무엇을 하는지로 나눈다 (2026-11-24). 동작이 어느 열에도 없으면 마지막 열(직접 할 것)에 둔다.
 *   결과 확인     대화의 결과 카드: 고른 것만 남긴다
 *   내보내기 · 실행 밖으로 나가거나 되돌리기 어려운 동작: 공개 · 발행 · 버튼 누르기 · 머지 · 코드 작업
 *   설정 바꾸기   AI가 제안한 바뀔 값: 바뀐 점 줄을 보고 승인
 *   직접 할 것    관리자가 먼저 무언가 해야 하는 것: 로그인 · 목표 실행의 다음 걸음
 */
const COLUMNS: readonly { key: string; title: string; actions: readonly string[] }[] = [
  { key: 'result', title: '결과 확인', actions: [CHAT_RESULT] },
  {
    key: 'out',
    title: '내보내기 · 실행',
    actions: [
      PUBLISH_POST,
      PUBLISH_ISSUE,
      SHOW_APP_CODE,
      PUBLISH_SITE,
      MERGE_PULL,
      START_CODE,
      CALL_API,
    ],
  },
  {
    key: 'setting',
    title: '설정 바꾸기',
    actions: [SETTING_CHANGE, PLUG_TOOL, PLUG_API, RAISE_LIMIT],
  },
  { key: 'mine', title: '직접 할 것', actions: [LOGIN_SITE, GOAL_CONTINUE, GOAL_COMPLETE] },
];

function columnOf(action: string): string {
  return COLUMNS.find((c) => c.actions.includes(action))?.key ?? 'mine';
}

/** 카드의 한 줄 설명: 설정 바꾸기는 무슨 설정인지, 나머지는 메모의 첫 줄 */
function summaryOf(a: Approval): string {
  const note = (a.note ?? '').split('\n')[0]?.trim() ?? '';
  const setting = a.setting ? (SETTING_NAMES[a.setting] ?? a.setting) : null;
  return [setting, note].filter(Boolean).join(' · ');
}

function mergePages(before: ApprovalPage, more: ApprovalPage): ApprovalPage {
  return { ...more, approvals: [...before.approvals, ...more.approvals] };
}

/** 승인 대기를 칸반으로 (2026-11-24): 열마다 오래 기다린 것부터. 카드를 누르면 그 승인을 연다 */
export function ApprovalBoard() {
  const list = useLiveValue(
    'approvals:board',
    () => readPages('/api/approvals?status=pending', PAGES, mergePages),
    APPROVAL_TOPICS,
  );
  const agents = useAgents();
  // 일꾼 목록에 대표는 없다: 에이전트가 없으면 서버가 올린 것, 목록에 없으면 대표의 것
  const nameOf = (agentId: string | null) =>
    agentId === null ? '서버' : (agents.data?.agents.find((a) => a.id === agentId)?.name ?? '대표');

  if (list.data === null)
    return list.error ? (
      <p className="error">{list.error}</p>
    ) : (
      <p className="label-mono loading">불러오는 중…</p>
    );
  const pending = list.data.approvals;
  if (pending.length === 0) return <p className="rows-empty">승인할 것 없음</p>;
  return (
    <>
      {list.error && <p className="error">{list.error}</p>}
      <div className="board">
        {COLUMNS.map((column) => {
          const cards = pending
            .filter((a) => columnOf(a.action) === column.key)
            .sort((x, y) => x.createdAt.localeCompare(y.createdAt));
          return (
            <section key={column.key} className="col" aria-label={column.title}>
              <div className="col-head">
                <span>{column.title}</span>
                <span>{cards.length}</span>
              </div>
              {cards.length === 0 ? (
                <p className="rows-empty">없음</p>
              ) : (
                cards.map((a) => (
                  <Link key={a.id} className="t-card" href={`/admin/approvals/${a.id}`}>
                    <b>{actionLabel(a.action)}</b>
                    {summaryOf(a) && <small>{summaryOf(a)}</small>}
                    <span className="t-who">
                      {nameOf(a.agentId)} · {ago(a.createdAt)}
                    </span>
                  </Link>
                ))
              )}
            </section>
          );
        })}
      </div>
      {list.data.next && (
        <p className="note">
          가장 최근 {pending.length}개만 보여요. 나머지는{' '}
          <Link href="/admin/approvals?status=pending">대기 목록</Link>에서
        </p>
      )}
    </>
  );
}
