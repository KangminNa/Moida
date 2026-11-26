'use client';

import { useState } from 'react';
import type { Owner } from '../../_account/types';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';

// 로그인 메일 (2026-11-26): 로그인 · 비밀번호 다시 정하기에 쓰는 메일. 아이디로 만든 계정을 메일로 옮기는 길이기도 하다.
// 새 메일로 받은 6자리 코드와 지금 비밀번호를 넣어야 바뀐다. 메일 플러그인을 켜야 코드가 간다
export function LoginEmail({
  owner,
  onChanged,
}: {
  owner: Owner;
  onChanged: (owner: Owner) => void;
}) {
  const usesEmail = owner.login.includes('@');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const sending = useAction();
  const action = useAction();
  const busy = action.busy !== null;

  async function sendCode() {
    const reply = await sending.run('code', () => api('POST', '/api/auth/email/code', { email }));
    if (reply?.ok) setSentTo(email.trim());
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const reply = await action.run(
      'email',
      () => api<Owner>('PUT', '/api/auth/email', { email, code, password }),
      { done: '로그인 메일을 바꿨어요' },
    );
    if (!reply?.ok) return;
    setEmail('');
    setCode('');
    setPassword('');
    setSentTo(null);
    onChanged(reply.data);
  }

  return (
    <form className="panel" onSubmit={save} aria-label="로그인 메일">
      <h2>로그인 메일</h2>
      <p className="note">
        {usesEmail
          ? `지금은 ${owner.login}. 비밀번호를 잊으면 이 메일로 인증코드를 받아요`
          : `지금은 아이디(${owner.login})로 로그인해요. 메일로 바꾸면 비밀번호를 잊었을 때 메일로 다시 정할 수 있어요`}
      </p>
      <label className="field">
        <span>새 메일</span>
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
        className="ghost"
        type="button"
        disabled={sending.busy !== null || !email}
        onClick={sendCode}
      >
        {sentTo ? '코드 다시 받기' : '코드 받기'}
      </button>
      {sentTo && <small>{sentTo}로 6자리 코드를 보냈어요 (10분)</small>}
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
        <span>지금 비밀번호</span>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      {action.problem && <p className="error">{action.problem}</p>}
      <button className="cta" type="submit" disabled={busy || code.length !== 6 || !password}>
        <span>{busy ? '바꾸는 중' : '로그인 메일 바꾸기'}</span>
        <span className="arr">→</span>
      </button>
    </form>
  );
}
