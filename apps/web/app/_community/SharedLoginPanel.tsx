'use client';

import { useState } from 'react';
import { api } from '../_lib/client-api';
import { useAction } from '../_lib/use-action';
import type { AccountSelf } from './types';

// 앱 없는 로그인 칸 (2026-11-27): 메일이나 아이디 + 비밀번호. 틀리면 서버가 늘 같은 문구로 답한다 (계정이 있는지 알려 주지 않는다).
// 로그인하면 이 도메인의 모든 앱에서 로그인돼 있다. 앱의 닉네임은 그 앱에 처음 들어갈 때 정한다.
// C안 화면(AuthTabs, 2026-11-28)에서는 가입이 옆 탭이라 아래 줄에 비밀번호 다시 정하기만 둔다
export function SharedLoginPanel({
  csrf,
  returnTo,
  resetHref,
  initialLogin = '',
  notice = null,
}: {
  csrf: string | null;
  returnTo: string;
  resetHref: string;
  /** 방금 가입한 아이디처럼 처음부터 채울 값 */
  initialLogin?: string;
  /** 칸 위의 안내 한 줄 (가입 뒤) */
  notice?: string | null;
}) {
  const [login, setLogin] = useState(initialLogin);
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
      {notice && (
        <p className="note" role="status">
          {notice}
        </p>
      )}
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
        <a href={resetHref}>비밀번호 다시 정하기</a>
      </p>
    </form>
  );
}
