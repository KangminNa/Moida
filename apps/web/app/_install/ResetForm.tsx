'use client';

import { useState } from 'react';
import { api } from '../_lib/client-api';
import { useAction } from '../_lib/use-action';
import { MoidaMark } from '../_ui/MoidaMark';

// 관리자 비밀번호 다시 정하기 카드 (2026-11-26). 로그인 메일로 6자리 코드를 받아 새 비밀번호를 정한다.
// 관리자 메일이 아니어도 답은 같다 (메일만 오지 않는다). 메일 플러그인이 꺼져 있으면 서버가 알린다:
// 그때와 아이디로 만든 계정은 서버에서 pnpm run owner reset-password
export function ResetForm({ returnTo }: { returnTo: string }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const sending = useAction();
  const action = useAction();
  const busy = action.busy !== null;
  const login = `/login?return=${encodeURIComponent(returnTo)}`;

  async function sendCode() {
    const reply = await sending.run('code', () =>
      api('POST', '/api/auth/password/code', { email }),
    );
    if (reply?.ok) setSentTo(email.trim());
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const reply = await action.run('reset', () =>
      api('POST', '/api/auth/password/reset', { email, code, password }),
    );
    if (reply?.ok) window.location.replace(login);
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
        <form className="panel-card" onSubmit={submit} aria-label="비밀번호 다시 정하기">
          <MoidaMark size={56} gather />
          <h1>비밀번호 다시 정하기</h1>
          <label className="field">
            <span>로그인 메일</span>
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
          </label>
          <button
            className="ghost wide"
            type="button"
            disabled={sending.busy !== null || !email}
            onClick={sendCode}
          >
            {sentTo ? '코드 다시 받기' : '코드 받기'}
          </button>
          {sentTo && <p className="note">관리자 메일이면 {sentTo}로 6자리 코드가 가요 (10분)</p>}
          {sending.problem && <p className="error">{sending.problem}</p>}
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
              minLength={10}
              required
            />
            <small>10자 이상. 정하면 모든 기기에서 로그아웃돼요</small>
          </label>
          {action.problem && <p className="error">{action.problem}</p>}
          <button className="cta" type="submit" disabled={busy || code.length !== 6 || !password}>
            <span>{busy ? '바꾸는 중' : '새 비밀번호로 바꾸기'}</span>
            <span className="arr">→</span>
          </button>
          <p className="label-mono">
            아이디로 만든 계정이거나 메일 플러그인이 꺼져 있으면 서버에서{' '}
            <code>pnpm run owner reset-password</code>로 다시 정해요. <a href={login}>로그인으로</a>
          </p>
        </form>
      </main>
    </>
  );
}
