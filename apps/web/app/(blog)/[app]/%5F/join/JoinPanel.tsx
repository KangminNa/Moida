'use client';

import { useState } from 'react';
import { memberApi } from '../../../../_community/member-api';
import type { MemberSelf } from '../../../../_community/types';
import type { ApiReply } from '../../../../_lib/client-api';
import { useAction } from '../../../../_lib/use-action';

/** 비밀번호 확인이 다를 때: 서버에 보내지 않는다 */
const MISMATCH: ApiReply<MemberSelf> = {
  ok: false,
  status: 0,
  error: { code: 'mismatch', message: '비밀번호 확인이 맞지 않아요' },
};

// 가입: 아이디 · 비밀번호 · 닉네임 · 만 14세 이상 확인 (규칙은 서버가 본다: 커뮤니티 CLAUDE.md의 회원 규칙)
export function JoinPanel({ csrf, returnTo }: { csrf: string | null; returnTo: string }) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [nickname, setNickname] = useState('');
  const [adult, setAdult] = useState(false);
  const action = useAction();
  const busy = action.busy !== null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const reply = await action.run('join', () =>
      password !== again
        ? Promise.resolve(MISMATCH)
        : memberApi<MemberSelf>(csrf, 'POST', 'join', {
            loginId,
            password,
            nickname,
            ageConfirmed: adult,
          }),
    );
    // 바꿔치기: 뒤로 가기로 가입 화면에 돌아가지 않게 (웹 UX U1). 새 쿠키의 쓰기 확인 값은 다음 화면이 읽는다
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
        <small>영문 소문자로 시작하는 4~20자. 바꿀 수 없어요</small>
      </label>
      <label className="field">
        <span>비밀번호</span>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
        <small>10자 이상. 아이디 · 닉네임과 다르게</small>
      </label>
      <label className="field">
        <span>비밀번호 확인</span>
        <input
          className="input"
          type="password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      <label className="field">
        <span>닉네임</span>
        <input
          className="input"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          required
        />
        <small>2~20자. 글 · 댓글에 보이는 이름이고 7일에 한 번 바꿀 수 있어요</small>
      </label>
      <label className="member-check">
        <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
        <span>만 14세 이상이에요</span>
      </label>
      {action.problem && <p className="error">{action.problem}</p>}
      <button
        className="cta"
        type="submit"
        disabled={busy || !loginId || !password || !again || !nickname || !adult}
      >
        {busy ? '가입하는 중' : '가입'}
      </button>
      <p className="member-hint">
        이미 회원이면 <a href={`/_/login?return=${encodeURIComponent(returnTo)}`}>로그인</a>.
        가입하고 5분 뒤부터 글 · 댓글을 쓸 수 있어요.
      </p>
    </form>
  );
}
