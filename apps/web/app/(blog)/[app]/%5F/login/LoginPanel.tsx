'use client';

import { useState } from 'react';
import { memberApi } from '../../../../_community/member-api';
import type { MemberSelf } from '../../../../_community/types';
import { useAction } from '../../../../_lib/use-action';

// 로그인. 틀리면 서버가 늘 같은 문구로 답한다 (아이디가 있는지 알려 주지 않는다), 여러 번 틀리면 잠시 막힌다
export function LoginPanel({ csrf, returnTo }: { csrf: string | null; returnTo: string }) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const action = useAction();
  const busy = action.busy !== null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const reply = await action.run('login', () =>
      memberApi<MemberSelf>(csrf, 'POST', 'login', { loginId, password }),
    );
    if (reply?.ok) window.location.replace(returnTo);
  }

  return (
    <form className="member-form" onSubmit={submit}>
      <label className="field">
        <span>아이디</span>
        <input
          className="input"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
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
      <button className="cta" type="submit" disabled={busy || !loginId || !password}>
        {busy ? '확인하는 중' : '로그인'}
      </button>
      <p className="member-hint">
        처음이면 <a href={`/_/join?return=${encodeURIComponent(returnTo)}`}>가입</a>. 비밀번호를
        잊었으면 운영자에게 초기화를 부탁해 주세요.
      </p>
    </form>
  );
}
