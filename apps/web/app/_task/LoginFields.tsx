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
// 간편 로그인 (2026-11-26): 사이트의 "카카오로 로그인" 같은 단추를 카드에서 누르면 AI 없는 러너가 그 단추를 누르고,
// 열린 그 회사의 로그인 화면(고정 목록의 주소)에서 찾은 아이디 · 비밀번호 칸을 카드에 띄운다. 못 찾으면 그 화면을 보이고
// 관리자가 휴대폰 승인이나 화면에서 마친 뒤 "로그인했어요"를 누른다.

const BASE = '/api/p/browser-tabs';
/** 러너가 넣는 동안 다시 읽는 간격 */
const POLL_MS = 2_000;
const LABELS: Record<string, { label: string; type: string; auto: string }> = {
  id: { label: '아이디', type: 'text', auto: 'username' },
  password: { label: '비밀번호', type: 'password', auto: 'current-password' },
  code: { label: '인증번호', type: 'text', auto: 'one-time-code' },
};
const PROVIDERS: Record<string, string> = {
  kakao: '카카오',
  naver: '네이버',
  google: '구글',
  apple: '애플',
};
const STATUS: Record<string, string> = {
  sent: '러너에게 보냈어요',
  filling: '하는 중',
  submitted: '로그인 단추를 눌렀어요',
  opened: '간편 로그인 화면을 열었어요',
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

  // 간편 로그인 화면이 열려 칸을 찾았으면 그 칸, 아니면 사이트의 칸
  const provider = attempt?.status === 'opened' ? attempt.provider : null;
  const fields = provider ? provider.fields : (card.fields ?? []);
  const origin = provider ? provider.origin : card.origin;
  const filled = fields.length > 0 && fields.every((f) => (values[f.kind] ?? '').length > 0);
  const waiting = attempt?.status === 'sent' || attempt?.status === 'filling';
  const submit = () =>
    void send
      .run(
        'login',
        () =>
          api('POST', `${BASE}/sites/${card.siteId}/login`, {
            values,
            ...(provider ? { step: 'provider' } : {}),
          }),
        { reload: reloadCard },
      )
      .then((reply) => {
        if (reply?.ok) setValues({});
      });
  const social = (company: string) =>
    void send.run(
      `social:${company}`,
      () => api('POST', `${BASE}/sites/${card.siteId}/login`, { social: company }),
      { reload: reloadCard },
    );

  return (
    <form
      className="panel"
      aria-label="로그인 칸"
      onSubmit={(e) => {
        e.preventDefault();
        if (filled && !waiting) submit();
      }}
    >
      {fields.length > 0 && (
        <p className="note">
          {provider && <b>{PROVIDERS[provider.provider] ?? provider.provider} 계정 · </b>}
          <b>{origin}</b>의 로그인 칸으로만 가요. AI는 보지 않고 어디에도 남지 않아요
        </p>
      )}
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
      {card.social.length > 0 && !provider && (
        <fieldset
          className="row"
          aria-label="간편 로그인"
          style={{ border: 0, padding: 0, margin: 0 }}
        >
          {card.social.map((s) => (
            <button
              key={s.provider}
              type="button"
              className="ghost"
              disabled={waiting || send.busy !== null}
              onClick={() => social(s.provider)}
            >
              {PROVIDERS[s.provider] ?? s.provider}로 로그인
            </button>
          ))}
        </fieldset>
      )}
      {attempt?.status === 'opened' && !provider && (
        <p className="note">
          간편 로그인 화면에서 넣을 칸을 찾지 못했어요. 휴대폰에서 승인하거나 아래 화면에서 마친 뒤
          “{LOGGED_IN_NOTE}”를 눌러 주세요
        </p>
      )}
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
      {fields.length > 0 && (
        <div className="row">
          <button
            type="submit"
            className="cta small"
            disabled={!filled || waiting || send.busy !== null}
          >
            {waiting ? '로그인하는 중…' : '로그인'}
          </button>
        </div>
      )}
    </form>
  );
}
