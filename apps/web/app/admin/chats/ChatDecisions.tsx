'use client';

import { useState } from 'react';
import { when } from '../../_task/labels';
import type { ChatNews } from '../../_task/types';

/** 판단의 모양 (서버 소식의 decision, post_update의 decision 그대로) */
export type Decision = {
  chosen: string;
  alternatives: string[];
  why: string;
  weight: string;
  step: string | null;
};

/** 소식의 decision 칸을 읽는다. 모양이 아니면 null (옛 판단 · 다른 종류) */
export function decisionOf(raw: unknown): Decision | null {
  const d = raw as Partial<Decision> | null;
  if (!d || typeof d.chosen !== 'string') return null;
  return {
    chosen: d.chosen,
    alternatives: Array.isArray(d.alternatives) ? d.alternatives.map(String) : [],
    why: typeof d.why === 'string' ? d.why : '',
    weight: typeof d.weight === 'string' ? d.weight : 'medium',
    step: typeof d.step === 'string' ? d.step : null,
  };
}

/** 판단 바꾸기로 보내는 말 (관리자의 말이라 대표가 그대로 받는다, 지시문 틀의 "판단 바꾸기") */
export function changeMessage(news: ChatNews, decision: Decision, change: string): string {
  const who = news.agent ?? '일꾼';
  return `판단 바꾸기 — ${who}: ${news.text} (고른 안: ${decision.chosen})\n→ ${change.trim()}`;
}

// 중간 판단 알림 (L1, 2026-11-21): 일꾼이 일하는 도중에 정한 것을 접지 않고 회차 아래에 보인다. 멈추지 않는 알림이고,
// "바꾸기"로 고쳐 말하면 회차의 덧붙인 말이 되어 대표의 다음 실행에 들어간다 (일꾼을 기다리는 중이면 패널이 먼저 깨운다).
// 고쳐 쓰는 칸은 이 조각의 상태다. 보내기는 패널이 한다
export function ChatDecisions({
  items,
  busy,
  onChange,
}: {
  items: readonly ChatNews[];
  busy: boolean;
  onChange: (news: ChatNews, decision: Decision, change: string) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [text, setText] = useState('');
  const shown = items.flatMap((n) => {
    const d = decisionOf(n.decision);
    return d ? [{ n, d }] : [];
  });
  if (shown.length === 0) return null;
  return (
    <ul className="decisions" aria-label="일꾼의 판단">
      {shown.map(({ n, d }) => (
        <li key={n.n} className="decision" data-weight={d.weight}>
          <span className="bubble-meta">
            {n.agent ?? '일꾼'} · 판단{d.step ? ` · ${d.step}` : ''} · {when(n.createdAt)}
          </span>
          <p className="text">
            <b>{n.text}</b>
          </p>
          <p className="decision-chosen">고른 안: {d.chosen}</p>
          {d.alternatives.length > 0 && <small>다른 안: {d.alternatives.join(' · ')}</small>}
          {d.why && <small>까닭: {d.why}</small>}
          {open === n.n ? (
            <div className="decision-change">
              <textarea
                className="input"
                rows={2}
                maxLength={1500}
                value={text}
                placeholder="어떻게 바꿀지 적어요"
                aria-label="판단 바꾸기"
                onChange={(e) => setText(e.target.value)}
              />
              <div className="row">
                <button
                  type="button"
                  className="cta small"
                  disabled={busy || !text.trim()}
                  onClick={() => {
                    onChange(n, d, text);
                    setOpen(null);
                    setText('');
                  }}
                >
                  바꾸기
                </button>
                <button type="button" className="ghost small" onClick={() => setOpen(null)}>
                  취소
                </button>
              </div>
            </div>
          ) : (
            <div className="row">
              <button type="button" className="ghost small" onClick={() => setOpen(n.n)}>
                바꾸기
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
