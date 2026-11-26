'use client';

import { useState } from 'react';
import { memberApi } from '../../../../_community/member-api';
import { useAction } from '../../../../_lib/use-action';

// 비밀번호 다시 정하기: 가입한 메일로 인증코드를 받아 새 비밀번호를 정한다 (2026-11-26).
// 가입하지 않은 메일이어도 답은 같다 (메일만 오지 않는다). 정하면 모든 기기에서 로그아웃되고 로그인 화면으로
export function ResetPanel({ csrf, returnTo }: { csrf: string | null; returnTo: string }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const sending = useAction();
  const action = useAction();
  const busy = action.busy !== null;
  const login = `/_/login?return=${encodeURIComponent(returnTo)}`;

  async function sendCode() {
    const reply = await sending.run('code', () =>
      memberApi<null>(csrf, 'POST', 'password/code', { email }),
    );
    if (reply?.ok) setSentTo(email.trim());
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const reply = await action.run('reset', () =>
      memberApi<null>(csrf, 'POST', 'password/reset', { email, code, password }),
    );
    if (reply?.ok) window.location.replace(login);
  }

  return (
    <form className="member-form" onSubmit={submit}>
      <label className="field">
        <span>가입한 메일</span>
        <span className="member-inline">
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
          <button
            className="ghost"
            type="button"
            disabled={sending.busy !== null || !email}
            onClick={sendCode}
          >
            {sentTo ? '다시 받기' : '코드 받기'}
          </button>
        </span>
        {sentTo && (
          <small>
            가입한 메일이면 {sentTo}로 6자리 코드가 가요 (10분). 없으면 스팸함을 봐 주세요
          </small>
        )}
        {sending.problem && <small className="error">{sending.problem}</small>}
      </label>
      <label className="field">
        <span>인증코드</span>
        <input
          className="input"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="6자리"
          required
        />
      </label>
      <label className="field">
        <span>새 비밀번호</span>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
        <small>10자 이상. 정하면 모든 기기에서 로그아웃돼요</small>
      </label>
      {action.problem && <p className="error">{action.problem}</p>}
      <button className="cta" type="submit" disabled={busy || code.length !== 6 || !password}>
        {busy ? '바꾸는 중' : '새 비밀번호로 바꾸기'}
      </button>
      <p className="member-hint">
        기억났으면 <a href={login}>로그인</a>.
      </p>
    </form>
  );
}
