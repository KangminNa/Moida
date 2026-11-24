'use client';

import { useState } from 'react';
import { memberApi } from '../../../../_community/member-api';
import { useAction } from '../../../../_lib/use-action';

// 탈퇴 (스토어 3-4): 지금 비밀번호를 넣고 한 번 더 묻는다. 아이디 · 닉네임 · 비밀번호 정보는 바로 지워지고 모든 로그인이 끝나며,
// 이미 쓴 글 · 댓글은 "탈퇴한 회원"으로 남는다 (지우고 싶은 글은 먼저 지운다). 되돌릴 수 없다
export function LeavePanel({ csrf, community }: { csrf: string | null; community: boolean }) {
  const [password, setPassword] = useState('');
  const leave = useAction();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      !window.confirm(
        '탈퇴하면 아이디 · 닉네임이 지워지고 되돌릴 수 없어요. 쓴 글 · 댓글은 "탈퇴한 회원"으로 남아요. 탈퇴할까요?',
      )
    )
      return;
    const reply = await leave.run('leave', () => memberApi(csrf, 'POST', 'me/leave', { password }));
    // 바꿔치기: 뒤로 가기로 내 정보에 돌아가지 않게 (웹 UX U1)
    if (reply?.ok) window.location.replace('/');
  }

  return (
    <form className="member-form" onSubmit={submit} aria-label="탈퇴">
      <b>탈퇴</b>
      <p className="member-hint">
        아이디 · 닉네임 · 비밀번호 정보가 바로 지워지고 다른 곳의 로그인도 끝나요.
        {community &&
          ' 쓴 글 · 댓글은 "탈퇴한 회원"으로 남으니, 남기고 싶지 않은 글은 먼저 지워 주세요.'}
      </p>
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
      {leave.problem && <p className="error">{leave.problem}</p>}
      <button className="ghost" type="submit" disabled={leave.busy !== null || !password}>
        {leave.busy ? '탈퇴하는 중' : '탈퇴'}
      </button>
    </form>
  );
}
