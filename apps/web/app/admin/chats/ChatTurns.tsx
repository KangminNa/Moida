'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ApprovalDetail } from '../../_task/ApprovalDetail';
import { clock, DELIVER_LABELS, NEWS_KINDS, OUTPUT_KINDS, tokens } from '../../_task/labels';
import { MarkdownText } from '../../_task/MarkdownText';
import { OutputOpen } from '../../_task/parts';
import type { ChatNews, ChatTurn, ChatTurnUsage } from '../../_task/types';
import { ChatDecisions, type Decision, decisionOf } from './ChatDecisions';
import { RefChips } from './ChatRefs';
import { LinkCards } from './LinkCards';

/** 일하는 중인 회차의 상태 */
const OPEN = ['queued', 'running', 'waiting'];
/**
 * 맡기 전의 주고받음 (첫 메시지 바로 아래): O-2 전 배정의 질문 · 맡음, 그리고 회차 작업이 없는 덧붙인 말(질문에 글로 한 답).
 * 회차가 남긴 질문(목표 확인, 2026-11-20)은 회차의 과정에 둔다 (질문 자체는 패널의 카드가 보인다)
 */
const BEFORE = ['question', 'routed'];
/** 회차의 과정 (접어 둔다): 팀이 남긴 소식. 덧붙인 말 · 짧은 답은 말풍선으로, 최종 답 · 실패는 답 자체라 뺀다 */
const PROCESS = [
  'progress',
  'decision',
  'assumption',
  'member_done',
  'member_failed',
  'review',
  'question',
];

const isBefore = (n: ChatNews, turns: readonly ChatTurn[]) =>
  (BEFORE.includes(n.kind) && !turns.some((t) => t.taskId === n.taskId)) ||
  (n.kind === 'appended' && n.taskId === null);

// 대화의 주고받음 (2차 1-5, ChatGPT · Claude 같은 모양): 관리자의 말풍선(오른쪽)과 답(왼쪽).
// 맡기 전에는 첫 메시지(pending)와 질문 · 답, 맡은 뒤에는 회차마다 메시지 → 덧붙인 말 · 짧은 답 → 받을 것 · 과정(접힘) → 답.
// 팀이 무엇을 하는지는 과정을 펼쳐야 보인다. 결과 카드에 싣지 않는 승인(사이트 로그인 등)만 답 아래에 둔다.
// 결과물 중심 (O-3): 서버가 연 회차는 지시문 원문 대신 한 줄(note), 결과물을 내는 회차의 긴 답은 세 줄까지 접는다
export function ChatTurns({
  turns,
  usage,
  news,
  pending,
  pendingRefs,
  me,
  partner,
  deliver,
  busy,
  onCancel,
  changing,
  onChangeDecision,
}: {
  turns: readonly ChatTurn[];
  /** 회차마다 쓴 토큰 (O-1). 없는 회차는 아직 실행 기록이 없다 */
  usage: readonly ChatTurnUsage[];
  news: readonly ChatNews[];
  /** 맡기 전의 첫 메시지 (맡았으면 null) */
  pending: string | null;
  /** 맡기 전의 첫 메시지와 함께 넣은 참조 (맡으면 첫 회차로 옮겨 간다) */
  pendingRefs: ChatTurn['refs'];
  me: string;
  /** 맡은 에이전트 (맡기 전이면 null) */
  partner: string | null;
  /** 대화에 정한 받을 것 (관리자 · 레시피). 회차에 정한 값이 먼저다 (O-3) */
  deliver: string | null;
  /** 지금 취소하는 회차의 작업 id */
  busy: string | null;
  onCancel: (taskId: string, version: number) => void;
  /** 판단 바꾸기를 보내는 중 (L1) */
  changing: boolean;
  onChangeDecision: (news: ChatNews, decision: Decision, change: string) => void;
}) {
  const before = news.filter((n) => isBefore(n, turns));
  return (
    <ol className="chat-log" aria-label="대화 내용">
      {pending !== null && turns.length === 0 && (
        <li className="chat-turn">
          <Mine who={me} text={pending} />
          <RefChips refs={pendingRefs} />
          <Before items={before} me={me} />
        </li>
      )}
      {turns.map((t, i) => {
        const next = turns[i + 1]?.createdAt ?? null;
        const within = news.filter(
          (n) =>
            !isBefore(n, turns) &&
            n.createdAt >= t.createdAt &&
            (next === null || n.createdAt < next),
        );
        const want = t.deliver ?? deliver;
        return (
          <li key={t.taskId} className="chat-turn">
            <Mine
              who={
                // 서버가 연 회차는 까닭 한 줄(note)이 말풍선에 있어 머리는 짧게 (O-3)
                t.fixBy === 'review'
                  ? '검토 반영'
                  : t.fixBy === 'setting'
                    ? '승인 뒤 이어서'
                    : t.fix
                      ? '검사'
                      : t.fromDevice
                        ? '기기의 AI 도구'
                        : me
              }
              at={t.createdAt}
              text={t.fix ? (t.note ?? fixLine(t.message)) : t.message}
            />
            <RefChips refs={t.refs} />
            {i === 0 && <Before items={before} me={me} />}
            {within
              .filter((n) => n.kind === 'appended' || n.kind === 'reply')
              .map((n) =>
                n.kind === 'appended' ? (
                  <Mine key={n.n} who={me} at={n.createdAt} text={n.text} />
                ) : (
                  <div key={n.n} className="bubble theirs">
                    <span className="bubble-meta">
                      {n.agent ?? partner} · {clock(n.createdAt)}
                    </span>
                    <p className="text">{n.text}</p>
                  </div>
                ),
              )}
            {want && (
              <p className="chat-event" title={t.deliverNote ?? undefined}>
                받을 것 · {DELIVER_LABELS[want] ?? want}
              </p>
            )}
            {/* 팀의 판단 (L1): 모양이 있는 판단은 접지 않고 보이고 바꿀 수 있다 */}
            <ChatDecisions items={within} busy={changing} onChange={onChangeDecision} />
            <Process
              turn={t}
              items={within.filter(
                (n) =>
                  PROCESS.includes(n.kind) && !(n.kind === 'decision' && decisionOf(n.decision)),
              )}
              usage={usage.find((u) => u.turn === t.turn) ?? null}
            />
            <div className="bubble theirs" aria-live={t.finishedAt ? undefined : 'polite'}>
              <span className="bubble-meta">
                {partner ?? '에이전트'}
                {t.finishedAt ? ` · ${clock(t.finishedAt)}` : ''}
              </span>
              <Status turn={t} news={within} />
              <Reply turn={t} fold={(want !== null && want !== 'answer') || t.outputs.length > 0} />
              {t.outputs.length > 0 && (
                <ul className="list" aria-label="결과물">
                  {t.outputs.map((o) => (
                    <li key={o.id} className="list-cell output-row">
                      <div className="output-main">
                        <b>{o.name}</b>
                        <small>{OUTPUT_KINDS[o.kind] ?? o.kind}</small>
                      </div>
                      <OutputOpen id={o.id} name={o.name} />
                    </li>
                  ))}
                </ul>
              )}
              {(t.status === 'queued' || t.status === 'running') && (
                <div className="row">
                  <button
                    type="button"
                    className="ghost small"
                    disabled={busy !== null}
                    onClick={() => onCancel(t.taskId, t.taskVersion)}
                  >
                    {busy === t.taskId ? '취소하는 중' : '이 답 취소'}
                  </button>
                </div>
              )}
            </div>
            {/* 결과 카드에 싣지 않는 승인(사이트 로그인 등)도 대표의 말로 보인다 (F2, 2026-11-21: 대화에는 AI 하나) */}
            {t.approvalIds.length > 0 && (
              <div className="bubble theirs">
                <span className="bubble-meta">{partner ?? '에이전트'} · 승인 필요</span>
                {t.approvalIds.map((id) => (
                  <div key={id} className="chat-approval">
                    <ApprovalDetail id={id} />
                  </div>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * 답 칸의 상태 한 줄 (F2, 2026-11-21 "대화에는 AI 하나"): 회차가 도는 동안 대표가 지금 하는 일을 접지 않고 보인다.
 * 가장 새 진행 소식(대표 · 일꾼이 post_update progress로 남긴 "웹 둘러보는 중 · 네이버 지도"), 없으면 회차의 마지막 기록,
 * 그것도 없으면 상태로 정한 말. 일꾼의 이름은 보이지 않는다 (과정을 펼치면 보인다)
 */
function Status({ turn: t, news }: { turn: ChatTurn; news: readonly ChatNews[] }) {
  if (!OPEN.includes(t.status)) return null;
  const latest = news.filter((n) => n.kind === 'progress').at(-1)?.text ?? null;
  const line =
    t.status === 'queued'
      ? '차례 기다리는 중'
      : t.status === 'waiting' && t.approvalIds.length > 0
        ? '승인 기다리는 중'
        : (latest ??
          t.progress ??
          (t.openSubtasks > 0 ? `일꾼 ${t.openSubtasks}명이 일하는 중` : '생각하는 중'));
  return (
    <p className="chat-status">
      <span className="dot run" aria-hidden="true" />
      {line}
    </p>
  );
}

function Mine({ who, at, text }: { who: string; at?: string; text: string }) {
  return (
    <div className="bubble mine">
      <span className="bubble-meta">
        {who}
        {at ? ` · ${clock(at)}` : ''}
      </span>
      <p className="text">{text}</p>
    </div>
  );
}

/** 맡기 전의 주고받음 (O-2 전 대화의 기록): 질문 · 글로 한 답 · 맡음 */
function Before({ items, me }: { items: readonly ChatNews[]; me: string }) {
  return items.map((n) =>
    n.kind === 'appended' ? (
      <Mine key={n.n} who={me} at={n.createdAt} text={n.text} />
    ) : n.kind === 'question' ? (
      <div key={n.n} className="bubble theirs">
        <span className="bubble-meta">질문 · {clock(n.createdAt)}</span>
        <p className="text">{n.text}</p>
      </div>
    ) : (
      <p key={n.n} className="chat-event">
        맡음 · {n.agent}
        {n.text && n.text !== n.agent ? ` · ${n.text}` : ''}
      </p>
    ),
  );
}

/**
 * 회차의 과정: 접어 둔다. 돌면 "일하는 중", 끝나면 "과정". 펼치면 팀이 남긴 소식과 작업.
 * 이 회차가 쓴 토큰(O-1)은 머리에 합계, 펼치면 에이전트별 (일하는 동안 늘어난다)
 */
function Process({
  turn: t,
  items,
  usage,
}: {
  turn: ChatTurn;
  items: readonly ChatNews[];
  usage: ChatTurnUsage | null;
}) {
  const open = OPEN.includes(t.status);
  if (!open && items.length === 0 && usage === null) return null;
  // 지금 하는 일 한 줄은 답 칸의 상태 줄(Status)이 보인다 (F2, 2026-11-21: 대화에는 AI 하나)
  return (
    <details className="chat-process">
      <summary>
        {open ? '일하는 중' : '과정'}
        {items.length > 0 ? ` · 소식 ${items.length}개` : ''}
        {usage ? ` · ${tokens(usage.tokens)} 토큰` : ''}
      </summary>
      {usage && (
        <p className="chat-event">
          {usage.agents.map((a) => `${a.name ?? '배정'} ${tokens(a.tokens)}`).join(' · ')}
        </p>
      )}
      <ol>
        {items.map((n) => (
          <li key={n.n}>
            <small>
              {NEWS_KINDS[n.kind] ?? n.kind}
              {n.agent ? ` · ${n.agent}` : ''} · {clock(n.createdAt)}
            </small>
            <span>{n.text}</span>
          </li>
        ))}
      </ol>
      <Link className="note" href={`/admin/tasks/${t.taskId}`}>
        작업 보기
      </Link>
    </details>
  );
}

/** 서버가 연 회차의 한 줄 (O-3 전 회차는 note가 없어 지시문 틀의 첫 줄에서 머리 표시를 뗀다) */
function fixLine(message: string): string {
  return (message.trim().split('\n')[0] ?? '').replace(/^#+\s*/, '');
}

/** 답: 끝났으면 글, 아니면 지금 상태 한 줄. fold: 결과물을 내는 회차라 긴 답은 세 줄까지 접는다 (O-3) */
function Reply({ turn: t, fold }: { turn: ChatTurn; fold: boolean }) {
  if (t.status === 'done')
    // 승인한 일을 서버가 실행해 끝난 회차에는 글 답이 없다
    return t.reply?.trim() ? (
      <>
        <Answer text={t.reply} fold={fold} />
        <LinkCards text={t.reply} />
      </>
    ) : (
      <p className="note">완료</p>
    );
  if (t.status === 'failed') return <p className="error">{t.error ?? '실패'}</p>;
  if (t.status === 'cancelled') return <p className="note">멈춤</p>;
  const doing =
    t.status === 'queued'
      ? '곧 시작해요'
      : t.waitReason === 'approval'
        ? '승인을 기다려요 · 아래 결과 카드에서 정하면 이어서 해요'
        : '일하는 중…';
  return <p className="note">{doing}</p>;
}

/** 결과물 중심 (O-3): 결과는 카드에 있으니 긴 답은 접고 펼칠 수 있게 (서버는 자르지 않는다) */
function Answer({ text, fold }: { text: string; fold: boolean }) {
  const [open, setOpen] = useState(false);
  const long = text.trim().split('\n').length > 3 || text.length > 240;
  if (!fold || !long || open) return <MarkdownText text={text} />;
  return (
    <>
      <div className="answer-fold">
        <MarkdownText text={text} />
      </div>
      <div className="row">
        <button type="button" className="ghost small" onClick={() => setOpen(true)}>
          펼치기
        </button>
      </div>
    </>
  );
}
