'use client';

import { useState } from 'react';
import { memberApi } from '../../../../_community/member-api';
import { useAction } from '../../../../_lib/use-action';

/** 나가기의 두 가지 (스토어 계정, 2026-11-26) */
const LEAVES = {
  app: {
    path: 'me/leave',
    button: '이 앱에서 나가기',
    ask: '이 앱에서 나가면 닉네임이 지워지고 되돌릴 수 없어요. 쓴 글 · 댓글은 "탈퇴한 회원"으로 남아요. 계정과 다른 앱은 그대로예요. 나갈까요?',
  },
  account: {
    path: 'account/leave',
    button: '계정 탈퇴',
    ask: '계정을 탈퇴하면 이 사이트의 모든 앱에서 나가고 메일 · 아이디가 지워져요. 되돌릴 수 없어요. 탈퇴할까요?',
  },
} as const;

// 나가기 (스토어 3-4, 스토어 계정 2026-11-26): 지금 비밀번호를 넣고 한 번 더 묻는다. 되돌릴 수 없다.
// 이 앱에서 나가기: 이 앱의 닉네임만 지우고 글 · 댓글은 "탈퇴한 회원"으로 남는다 (계정 · 로그인 · 다른 앱은 그대로).
// 계정 탈퇴: 모든 앱에서 나가고 메일 · 아이디 · 비밀번호 정보를 바로 지우며 모든 로그인이 끝난다
export function LeavePanel({ csrf, community }: { csrf: string | null; community: boolean }) {
  const [password, setPassword] = useState('');
  const leave = useAction();

  async function run(kind: keyof typeof LEAVES) {
    if (!window.confirm(LEAVES[kind].ask)) return;
    const reply = await leave.run(kind, () =>
      memberApi(csrf, 'POST', LEAVES[kind].path, { password }),
    );
    // 바꿔치기: 뒤로 가기로 내 정보에 돌아가지 않게 (웹 UX U1)
    if (reply?.ok) window.location.replace('/');
  }

  return (
    <form className="member-form" onSubmit={(e) => e.preventDefault()} aria-label="나가기">
      <b>나가기</b>
      <p className="member-hint">
        이 앱에서만 나가거나, 이 사이트의 계정을 탈퇴할 수 있어요.
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
      {(['app', 'account'] as const).map((kind) => (
        <button
          key={kind}
          className="ghost"
          type="button"
          onClick={() => run(kind)}
          disabled={leave.busy !== null || !password}
        >
          {leave.busy === kind ? '처리하는 중' : LEAVES[kind].button}
        </button>
      ))}
    </form>
  );
}
