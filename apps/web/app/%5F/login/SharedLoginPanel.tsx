'use client';

import { useState } from 'react';
import type { AccountSelf } from '../../_community/types';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';

// 앱 없는 로그인 칸 (2026-11-27): 메일이나 아이디 + 비밀번호. 틀리면 서버가 늘 같은 문구로 답한다 (계정이 있는지 알려 주지 않는다).
// 로그인하면 이 도메인의 모든 앱에서 로그인돼 있다. 앱의 닉네임은 그 앱에 처음 들어갈 때 정한다
export function SharedLoginPanel({
  csrf,
  returnTo,
  resetHref,
}: {
  csrf: string | null;
  returnTo: string;
  resetHref: string | null;
}) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const action = useAction();
  const busy = action.busy !== null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const reply = await action.run('login', () =>
      api<AccountSelf>(
        'POST',
        '/api/store/login',
        { login, password },
        csrf ? { 'x-cairn-csrf': csrf } : {},
      ),
    );
    if (reply?.ok) window.location.replace(returnTo);
  }

  return (
    <form className="member-form" onSubmit={submit}>
      <label className="field">
        <span>메일 또는 아이디</span>
        <input
          className="input"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        <small>한 번 로그인하면 모든 앱에서 그대로예요</small>
      </label>
      <label className="field">
        <span>비밀번호</span>
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
      <button className="cta" type="submit" disabled={busy || !login || !password}>
        {busy ? '확인하는 중' : '로그인'}
      </button>
      <p className="member-hint">
        처음이면 <a href="/join">가입</a>.
        {resetHref && (
          <>
            {' '}
            비밀번호를 잊었으면 <a href={resetHref}>메일로 다시 정하기</a>.
          </>
        )}
      </p>
    </form>
  );
}
