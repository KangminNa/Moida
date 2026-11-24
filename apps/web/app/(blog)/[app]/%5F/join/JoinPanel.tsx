'use client';

import { useState } from 'react';
import { memberApi } from '../../../../_community/member-api';
import { TermText } from '../../../../_community/TermText';
import type { MemberSelf, Term } from '../../../../_community/types';
import type { ApiReply } from '../../../../_lib/client-api';
import { useAction } from '../../../../_lib/use-action';

/** 비밀번호 확인이 다를 때: 서버에 보내지 않는다 */
const MISMATCH: ApiReply<MemberSelf> = {
  ok: false,
  status: 0,
  error: { code: 'mismatch', message: '비밀번호 확인이 맞지 않아요' },
};

// 가입: 아이디 · 비밀번호 · 닉네임 · 만 14세 이상 확인 · 약관 동의 (규칙은 서버가 본다: 커뮤니티 CLAUDE.md의 회원 규칙).
// 약관(3-4)은 이 화면에서 펼쳐 읽고 동의한다 (다른 화면으로 가면 쓰던 칸이 사라진다). 읽은 버전을 함께 보내고,
// 그사이 새 버전이 올라왔으면 서버가 409로 다시 읽게 한다. 약관이 아직 없으면 가입을 받지 않는다
// community: 커뮤니티 앱인가 (글 · 댓글의 가입 직후 대기를 알린다. 그 밖의 앱에는 글 · 댓글이 없다)
export function JoinPanel({
  csrf,
  returnTo,
  community,
  terms,
  privacy,
}: {
  csrf: string | null;
  returnTo: string;
  community: boolean;
  terms: Term | null;
  privacy: Term | null;
}) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [nickname, setNickname] = useState('');
  const [adult, setAdult] = useState(false);
  const [agreed, setAgreed] = useState(false);
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
            termsVersion: terms?.version,
            privacyVersion: privacy?.version,
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
      {terms && privacy ? (
        <>
          <details className="member-terms">
            <summary>이용약관 보기</summary>
            <TermText term={terms} />
          </details>
          <details className="member-terms">
            <summary>개인정보처리방침 보기</summary>
            <TermText term={privacy} />
          </details>
          <label className="member-check">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>이용약관과 개인정보처리방침에 동의해요</span>
          </label>
        </>
      ) : (
        <p className="error">아직 약관이 공개되지 않아 가입할 수 없어요</p>
      )}
      {action.problem && <p className="error">{action.problem}</p>}
      <button
        className="cta"
        type="submit"
        disabled={busy || !loginId || !password || !again || !nickname || !adult || !agreed}
      >
        {busy ? '가입하는 중' : '가입'}
      </button>
      <p className="member-hint">
        이미 회원이면 <a href={`/_/login?return=${encodeURIComponent(returnTo)}`}>로그인</a>.
        {community && ' 가입하고 5분 뒤부터 글 · 댓글을 쓸 수 있어요.'}
      </p>
    </form>
  );
}
