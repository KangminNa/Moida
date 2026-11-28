'use client';

import { useState } from 'react';
import type { Consent, ConsentResult } from '../_account/types';
import { api } from '../_lib/client-api';
import { SCOPE_LABELS } from '../_lib/types';
import { useAction } from '../_lib/use-action';
import { MoidaMark } from '../_ui/MoidaMark';

// 기기 연결 승인 카드. 연결하면 AI 도구가 기다리는 주소로 돌아가고, 도구가 토큰을 받아 붙는다.
// ChatGPT·Claude 앱의 연결이면 남이 만든 링크로 그 사람의 앱에 블로그를 내주지 않게 한 번 더 알린다.
// 권한: 앱이 기기 모양을 요청했으면 그 권한 그대로(moida connect의 소식 기기: 소식 읽기). 아니면 묶음을 고른다(2026-11-27):
// 기록만 · 업무용(먼저 골라 둠) · 전부. 업무용이면 바깥 AI 도구가 대표에게 맡기고 결과 · 승인 대기 · 결과물까지 읽는다.
// 승인 · 발행 · 전송은 어느 묶음이어도 콘솔에서만 한다
/** 권한 묶음의 화면 이름과 한 줄 (서버 Device.PRESETS의 이름) */
const PRESET_LABELS: Readonly<Record<string, readonly [string, string]>> = {
  record: ['기록만', '세션 저장 · 공개 자료 읽기'],
  work: ['업무용', '대표에게 맡기기 · 결과 · 결과물 · 승인 대기 보기 · 비공개 읽기 · 초안 쓰기'],
  all: ['전부', '업무용 + 세션 정리'],
};

export function ConsentCard({
  request,
  consent,
  problem,
}: {
  request: string;
  consent: Consent | null;
  problem: string | null;
}) {
  const [name, setName] = useState(consent?.name ?? '');
  const [preset, setPreset] = useState('work');
  const presets = consent?.presets ?? null;
  const scopes = presets?.find((p) => p.name === preset)?.scopes ?? consent?.scopes ?? [];
  const action = useAction();
  const busy = action.busy !== null;
  // 승인 요청을 읽지 못했으면 problem만 있고 버튼이 없다
  const error = action.problem ?? problem;

  async function decide(approve: boolean) {
    const reply = await action.run('decide', () =>
      api<ConsentResult>(
        'POST',
        approve ? '/api/connect/approve' : '/api/connect/deny',
        approve ? { request, name, ...(presets ? { preset } : {}) } : { request },
      ),
    );
    if (reply?.ok) window.location.href = reply.data.redirect;
  }

  return (
    <>
      <header className="top">
        <a className="brand" href="/" aria-label="홈">
          <MoidaMark />
          Moida
        </a>
      </header>
      <main className="center">
        <section className="panel-card" aria-label="기기 연결">
          <MoidaMark size={56} gather />
          {consent ? (
            <>
              <h1>{consent.clientName}를 연결할까요?</h1>
              <p>
                아래 권한으로만 연결해요. 돌아갈 곳: <code>{consent.redirectHost}</code>
              </p>
              {consent.app && (
                <p className="warn" role="alert">
                  {consent.app} 앱의 연결이에요. 방금 {consent.app}에서 직접 연결을 눌렀을 때만
                  승인하고 다른 사람이 보낸 링크라면 거절해요
                </p>
              )}
              {presets && (
                <fieldset className="field">
                  <legend>권한 묶음</legend>
                  {presets.map((p) => (
                    <label key={p.name} className="check">
                      <input
                        type="radio"
                        name="preset"
                        value={p.name}
                        checked={preset === p.name}
                        onChange={() => setPreset(p.name)}
                      />
                      <span>
                        <b>{PRESET_LABELS[p.name]?.[0] ?? p.name}</b>{' '}
                        <small>{PRESET_LABELS[p.name]?.[1]}</small>
                      </span>
                    </label>
                  ))}
                  <small>승인 · 발행 · 전송은 어느 묶음이어도 콘솔에서만 해요</small>
                </fieldset>
              )}
              <ul className="uses" aria-label="받는 권한">
                {scopes.map((s) => (
                  <li key={s}>{SCOPE_LABELS[s] ?? s}</li>
                ))}
              </ul>
              <label className="field">
                <span>기기 이름</span>
                <input
                  className="input"
                  value={name}
                  maxLength={60}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="예: macbook-home"
                />
                <small>콘솔의 기기 목록에 이 이름으로 보여요. 권한 바꾸기도 거기서 해요</small>
              </label>
              {error && <p className="error">{error}</p>}
              <button
                className="cta"
                type="button"
                disabled={busy || !name.trim()}
                onClick={() => decide(true)}
              >
                <span>{busy ? '연결하는 중' : '연결'}</span>
                <span className="arr">→</span>
              </button>
              <button
                className="ghost wide"
                type="button"
                disabled={busy}
                onClick={() => decide(false)}
              >
                거절
              </button>
            </>
          ) : (
            <>
              <h1>연결할 수 없어요</h1>
              <p className="error">{error}</p>
              <a className="cta" href="/admin">
                <span>콘솔로</span>
                <span className="arr">→</span>
              </a>
            </>
          )}
        </section>
      </main>
    </>
  );
}
