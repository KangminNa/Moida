'use client';

import { useEffect, useState } from 'react';
import { api } from '../_lib/client-api';
import { useAction } from '../_lib/use-action';
import { CONFIRM_LABELS, remaining } from './labels';
import type { Approval } from './types';

const TICK_MS = 30_000;

/** 남은 시간 (기한이 있는 승인, L3). 30초마다 다시 그린다. 기한이 없으면 아무것도 그리지 않는다 */
export function Remaining({ until }: { until: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [until]);
  if (!until) return null;
  return <span className="label-mono">{remaining(until, now)}</span>;
}

// 확인 필요 판단 (L3, 2026-11-28): 일꾼이 멈추고 고를 안을 올렸다. 추천안(일꾼이 고른 안) · 다른 안 가운데 하나를 고르거나,
// 다르게 하라고 적거나(수정 요청), 일을 멈춘다(반려). 기한이 있으면 남은 시간을 보이고, 지나면 서버가 추천안으로 정한다
export function DecisionTarget({ approval: a }: { approval: Approval }) {
  const d = a.decision;
  if (!d) return null;
  return (
    <div className="decision-ask">
      <p className="text">
        <b>{d.text}</b>
      </p>
      {d.confirm && <span className="pill">{CONFIRM_LABELS[d.confirm] ?? d.confirm}</span>}
      {d.why && <small>까닭: {d.why}</small>}
      {a.status === 'pending' ? (
        a.expiresAt ? (
          <small>
            답이 없으면 추천안으로 이어서 해요 · <Remaining until={a.expiresAt} />
          </small>
        ) : (
          <small>되돌리기 어려운 판단이라 답을 기다려요</small>
        )
      ) : (
        d.picked && <p className="decision-chosen">고른 안: {d.picked}</p>
      )}
    </div>
  );
}

export function DecisionDecide({
  approval: a,
  reload,
}: {
  approval: Approval;
  reload: () => Promise<void>;
}) {
  const action = useAction();
  const [note, setNote] = useState('');
  const busy = action.busy !== null;
  const d = a.decision;
  if (!d) return null;
  const options = [d.chosen, ...d.alternatives];

  function send(decision: string, extra: Record<string, unknown>, done: string) {
    void action.run(
      `${decision}:${String(extra.choice ?? '')}`,
      () =>
        api<Approval>('POST', `/api/approvals/${a.id}/decide`, {
          version: a.version,
          decision,
          ...extra,
        }),
      { done, reload, conflict: '이미 정해진 판단이에요. 최신 내용을 다시 읽었어요' },
    );
  }

  return (
    <div className="decide">
      <fieldset className="choices" aria-label="고를 안">
        {options.map((option, i) => (
          <button
            key={option}
            type="button"
            className={i === 0 ? 'cta small' : 'ghost'}
            disabled={busy}
            onClick={() => send('approve', { choice: i }, `${option}(으)로 이어서 해요`)}
          >
            {i === 0 ? `추천 · ${option}` : option}
          </button>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor={`decision-note-${a.id}`}>다르게 하기</label>
        <textarea
          id={`decision-note-${a.id}`}
          className="input"
          rows={2}
          maxLength={4000}
          value={note}
          placeholder="어떻게 할지 적어요"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {action.problem && <p className="error">{action.problem}</p>}
      <div className="row">
        <button
          type="button"
          className="ghost"
          disabled={busy || !note.trim()}
          onClick={() => send('revise', { note: note.trim() }, '말한 대로 이어서 해요')}
        >
          이대로 하기
        </button>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => send('reject', {}, '일을 멈췄어요')}
        >
          일 멈추기
        </button>
      </div>
    </div>
  );
}
