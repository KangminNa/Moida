'use client';

import { useState } from 'react';
import type { ApiReply } from '../_lib/client-api';
import { useAction } from '../_lib/use-action';
import { accountApi } from './member-api';

const MISMATCH: ApiReply<null> = {
  ok: false,
  status: 0,
  error: { code: 'mismatch', message: '새 비밀번호 확인이 맞지 않아요' },
};

// 계정 비밀번호 바꾸기: 지금 비밀번호 + 새 비밀번호 두 번. 바꾸면 이 브라우저 말고 다른 곳의 로그인은 끝난다.
// 앱의 내 정보와 공통 앱 도메인의 앱 없는 내 정보(shared, 2026-11-28)가 함께 쓴다
export function PasswordPanel({ csrf, shared = false }: { csrf: string | null; shared?: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [changed, setChanged] = useState(false);
  const password = useAction();
  const call = accountApi(shared);

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    const reply = await password.run('password', () =>
      next !== again
        ? Promise.resolve(MISMATCH)
        : call<null>(csrf, 'PATCH', 'me/password', { current, next }),
    );
    if (!reply?.ok) return;
    setCurrent('');
    setNext('');
    setAgain('');
    setChanged(true);
  }

  return (
    <form className="member-form" onSubmit={savePassword} aria-label="비밀번호 바꾸기">
      <label className="field">
        <span>지금 비밀번호</span>
        <input
          className="input"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      <label className="field">
        <span>새 비밀번호</span>
        <input
          className="input"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          required
        />
        <small>
          10자 이상. 이 사이트의 모든 앱에 쓰는 비밀번호예요. 바꾸면 이 브라우저 말고 다른 곳의
          로그인은 끝나요
        </small>
      </label>
      <label className="field">
        <span>새 비밀번호 확인</span>
        <input
          className="input"
          type="password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      {password.problem && <p className="error">{password.problem}</p>}
      {changed && <p className="note">비밀번호를 바꿨어요</p>}
      <button
        className="ghost"
        type="submit"
        disabled={password.busy !== null || !current || !next || !again}
      >
        {password.busy ? '바꾸는 중' : '비밀번호 바꾸기'}
      </button>
    </form>
  );
}
