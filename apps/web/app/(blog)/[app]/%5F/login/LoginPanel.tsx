'use client';

import { useState } from 'react';
import { memberApi } from '../../../../_community/member-api';
import type { AccountSelf } from '../../../../_community/types';
import { useAction } from '../../../../_lib/use-action';

// 로그인: 메일이나 아이디 + 비밀번호 (스토어 계정, 2026-11-26). 이 사이트의 다른 앱에서 가입한 계정도 그대로 쓴다.
// 틀리면 서버가 늘 같은 문구로 답한다 (계정이 있는지 알려 주지 않는다), 여러 번 틀리면 잠시 막힌다.
// 로그인한 뒤에는 참여 화면을 거친다: 이 앱에 이미 참여했으면 그 화면이 돌아갈 곳으로 바로 보낸다
export function LoginPanel({ csrf, returnTo }: { csrf: string | null; returnTo: string }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const action = useAction();
  const busy = action.busy !== null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const reply = await action.run('login', () =>
      memberApi<AccountSelf>(csrf, 'POST', 'login', { login, password }),
    );
    if (reply?.ok) window.location.replace(`/_/enter?return=${encodeURIComponent(returnTo)}`);
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
        <small>이 사이트의 다른 앱에서 가입했어도 같은 계정으로 로그인해요</small>
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
        처음이면 <a href={`/_/join?return=${encodeURIComponent(returnTo)}`}>가입</a>. 비밀번호를
        잊었으면 <a href={`/_/reset?return=${encodeURIComponent(returnTo)}`}>메일로 다시 정하기</a>.
      </p>
    </form>
  );
}
