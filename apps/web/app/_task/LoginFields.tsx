'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '../_lib/client-api';
import { useAction } from '../_lib/use-action';
import { useLiveValue } from '../_lib/use-live';
import { LOGGED_IN_NOTE } from './labels';
import type { Approval, BrowserLoginCard } from './types';

// 로그인 카드의 칸 (2026-11-19 사용자 결정, 원칙 8을 바꿈). AI가 알려 준 로그인 칸(아이디 · 비밀번호 · 인증번호)에 관리자가 넣으면
// 값은 서버 메모리에만 잠깐 있다가 AI 없는 러너가 그 사이트의 칸에 넣고 로그인 단추를 누른다. AI · 기록 · DB에 남지 않는다.
// 러너가 누르면 그 뒤 화면을 보여 주고 "로그인했어요"로 같은 작업을 바로 잇는다. 칸이 없으면(믿지 않는 출처 · 캡차) 화면에서 직접.

const BASE = '/api/p/browser-tabs';
/** 러너가 넣는 동안 다시 읽는 간격 */
const POLL_MS = 2_000;
const LABELS: Record<string, { label: string; type: string; auto: string }> = {
  id: { label: '아이디', type: 'text', auto: 'username' },
  password: { label: '비밀번호', type: 'password', auto: 'current-password' },
  code: { label: '인증번호', type: 'text', auto: 'one-time-code' },
};
const STATUS: Record<string, string> = {
  sent: '러너에게 보냈어요',
  filling: '로그인하는 중',
  submitted: '로그인 단추를 눌렀어요',
  failed: '넣지 못했어요',
  expired: '시간이 지나 버렸어요',
};

/** 사이트의 로그인 칸과 진행 상태. 러너가 넣는 동안에는 2초마다 다시 읽는다 */
export function useLoginCard(siteId: string | null) {
  const card = useLiveValue<BrowserLoginCard | null>(
    `browser-login:${siteId ?? 'none'}`,
    () =>
      siteId
        ? api<BrowserLoginCard>('GET', `${BASE}/sites/${siteId}/login`)
        : Promise.resolve({ ok: true, data: null } as const),
    [],
  );
  const status = card.data?.attempt?.status ?? null;
  const { reload } = card;
  useEffect(() => {
    if (status !== 'sent' && status !== 'filling') return;
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [status, reload]);
  return card;
}

/** 칸에 넣기 → 러너가 로그인 → 그 뒤 화면 · 같은 작업 잇기 */
export function LoginFields({
  approval,
  card,
  reloadCard,
  reload,
}: {
  approval: Approval;
  card: BrowserLoginCard;
  reloadCard: () => Promise<void>;
  reload?: () => Promise<void>;
}) {
  const send = useAction();
  const go = useAction();
  const [values, setValues] = useState<Record<string, string>>({});
  const attempt = card.attempt;
  const continued = useRef<string | null>(null);

  // 러너가 로그인 단추를 누르면 "로그인했어요"로 같은 작업을 잇는다 (한 번만)
  useEffect(() => {
    if (attempt?.status !== 'submitted' || approval.status !== 'pending') return;
    if (continued.current === attempt.at) return;
    continued.current = attempt.at;
    void go.run(
      'continue',
      () =>
        api<Approval>('POST', `/api/approvals/${approval.id}/decide`, {
          version: approval.version,
          decision: 'revise',
          note: LOGGED_IN_NOTE,
        }),
      { done: '로그인하고 이어서 해요', reload, conflict: '이미 바뀐 승인이에요' },
    );
  }, [attempt, approval, go, reload]);

  const fields = card.fields ?? [];
  const filled = fields.every((f) => (values[f.kind] ?? '').length > 0);
  const waiting = attempt?.status === 'sent' || attempt?.status === 'filling';
  const submit = () =>
    void send
      .run('login', () => api('POST', `${BASE}/sites/${card.siteId}/login`, { values }), {
        reload: reloadCard,
      })
      .then((reply) => {
        if (reply?.ok) setValues({});
      });

  return (
    <form
      className="panel"
      aria-label="로그인 칸"
      onSubmit={(e) => {
        e.preventDefault();
        if (filled && !waiting) submit();
      }}
    >
      <p className="note">
        <b>{card.origin}</b>의 로그인 칸으로만 가요. AI는 보지 않고, 어디에도 남지 않아요
      </p>
      {fields.map((f) => {
        const meta = LABELS[f.kind] ?? { label: f.kind, type: 'text', auto: 'off' };
        return (
          <div className="field" key={f.kind}>
            <label htmlFor={`login-${f.kind}`}>{meta.label}</label>
            <input
              id={`login-${f.kind}`}
              className="input"
              type={meta.type}
              autoComplete={meta.auto}
              inputMode={f.kind === 'code' ? 'numeric' : undefined}
              value={values[f.kind] ?? ''}
              disabled={waiting}
              onChange={(e) => setValues((v) => ({ ...v, [f.kind]: e.target.value }))}
            />
          </div>
        );
      })}
      {send.problem && <p className="error">{send.problem}</p>}
      {go.problem && <p className="error">{go.problem}</p>}
      {attempt && (
        <p
          className={attempt.status === 'failed' || attempt.status === 'expired' ? 'error' : 'note'}
        >
          {STATUS[attempt.status] ?? attempt.status}
          {attempt.reason ? ` · ${attempt.reason}` : ''}
        </p>
      )}
      {attempt?.image && (
        // biome-ignore lint/performance/noImgElement: 관리자만 보는 화면 그림(base64)이라 Next의 이미지 최적화를 거치지 않는다
        <img
          src={`data:image/jpeg;base64,${attempt.image}`}
          alt="로그인 뒤 화면"
          style={{ display: 'block', width: '100%', height: 'auto' }}
        />
      )}
      <div className="row">
        <button
          type="submit"
          className="cta small"
          disabled={!filled || waiting || send.busy !== null}
        >
          {waiting ? '로그인하는 중…' : '로그인'}
        </button>
      </div>
    </form>
  );
}
