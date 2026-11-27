'use client';

import { useState } from 'react';
import { memberApi } from '../../../../_community/member-api';
import { type AgreeTerms, agreedVersions, TermsAgree } from '../../../../_community/TermsAgree';
import type { MemberMe } from '../../../../_community/types';
import type { ApiReply } from '../../../../_lib/client-api';
import { useAction } from '../../../../_lib/use-action';

/** 비밀번호 확인이 다를 때: 서버에 보내지 않는다 */
const MISMATCH: ApiReply<MemberMe> = {
  ok: false,
  status: 0,
  error: { code: 'mismatch', message: '비밀번호 확인이 맞지 않아요' },
};

// 가입: 스토어 계정 하나를 만들고 이 앱에 참여한다 (2026-11-26). 메일 인증코드 · 아이디 · 비밀번호 · 이 앱의 닉네임 ·
// 만 14세 이상 확인 · 약관 동의 (규칙은 서버가 본다: 커뮤니티 CLAUDE.md의 계정 · 회원 규칙).
// 메일을 넣고 "코드 받기" → 메일로 온 6자리를 넣는다. 가입한 메일이어도 답은 같다 (그 메일로 안내가 간다).
// 약관은 공통 약관(이 사이트)과 이 앱이 공개한 약관을 이 화면에서 펼쳐 읽고 한 번에 동의한다. 읽은 버전을 함께 보내고,
// 그사이 새 버전이 올라왔으면 서버가 409로 다시 읽게 한다. 공통 약관이 아직 없으면 가입을 받지 않는다
// community: 커뮤니티 앱인가 (글 · 댓글의 가입 직후 대기를 알린다. 그 밖의 앱에는 글 · 댓글이 없다)
export function JoinPanel({
  csrf,
  returnTo,
  community,
  terms,
}: {
  csrf: string | null;
  returnTo: string;
  community: boolean;
  terms: AgreeTerms;
}) {
  const [email, setEmail] = useState('');
  const [loginId, setLoginId] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [nickname, setNickname] = useState('');
  const [adult, setAdult] = useState(false);
  /** 소식 메일 받기 (선택, 2026-11-27): 체크하지 않아도 가입한다 */
  const [news, setNews] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const action = useAction();
  const sending = useAction();
  const busy = action.busy !== null;

  async function sendCode() {
    const reply = await sending.run('code', () =>
      memberApi<null>(csrf, 'POST', 'join/code', { email }),
    );
    if (reply?.ok) setSentTo(email.trim());
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const reply = await action.run('join', () =>
      password !== again
        ? Promise.resolve(MISMATCH)
        : memberApi<MemberMe>(csrf, 'POST', 'join', {
            email,
            code,
            loginId,
            password,
            nickname,
            ageConfirmed: adult,
            newsMail: news,
            ...agreedVersions(terms, true),
          }),
    );
    // 바꿔치기: 뒤로 가기로 가입 화면에 돌아가지 않게 (웹 UX U1). 새 쿠키의 쓰기 확인 값은 다음 화면이 읽는다
    if (reply?.ok) window.location.replace(returnTo);
  }

  return (
    <form className="member-form" onSubmit={submit}>
      <label className="field">
        <span>메일</span>
        <span className="member-inline">
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
          <button
            className="ghost"
            type="button"
            disabled={sending.busy !== null || !email}
            onClick={sendCode}
          >
            {sentTo ? '다시 받기' : '코드 받기'}
          </button>
        </span>
        <small>
          {sentTo
            ? `${sentTo}로 6자리 코드를 보냈어요 (10분). 없으면 스팸함을 봐 주세요`
            : '이 사이트의 모든 앱에 쓰는 계정의 메일이에요. 바꿀 수 없어요'}
        </small>
        {sending.problem && <small className="error">{sending.problem}</small>}
      </label>
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
        <span>아이디</span>
        <input
          className="input"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value.toLowerCase())}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        <small>
          영문 소문자로 시작하는 4~20자 (영문 소문자 · 숫자 · _). 메일 대신 로그인에 써요
        </small>
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
        <small>10자 이상. 메일 · 아이디 · 닉네임과 다르게</small>
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
        <small>2~20자. 이 앱에서 보이는 이름이고 앱마다 따로 정해요 (7일에 한 번 바꿈)</small>
      </label>
      <label className="member-check">
        <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
        <span>만 14세 이상이에요</span>
      </label>
      {terms.terms && terms.privacy ? (
        <TermsAgree terms={terms} store agreed={agreed} onChange={setAgreed} />
      ) : (
        <p className="error">아직 약관이 공개되지 않아 가입할 수 없어요</p>
      )}
      <label className="member-check">
        <input type="checkbox" checked={news} onChange={(e) => setNews(e.target.checked)} />
        <span>
          (선택) 소식 메일 받기
          <small className="member-hint">
            새 앱 · 소식 같은 광고성 메일이에요. 내 정보에서 언제든 끌 수 있어요
          </small>
        </span>
      </label>
      {action.problem && <p className="error">{action.problem}</p>}
      <button
        className="cta"
        type="submit"
        disabled={
          busy ||
          code.length !== 6 ||
          !loginId ||
          !password ||
          !again ||
          !nickname ||
          !adult ||
          !agreed
        }
      >
        {busy ? '가입하는 중' : '가입'}
      </button>
      <p className="member-hint">
        이 사이트의 다른 앱에서 가입했으면 같은 계정으로{' '}
        <a href={`/_/login?return=${encodeURIComponent(returnTo)}`}>로그인</a>.
        {community && ' 가입하고 5분 뒤부터 글 · 댓글을 쓸 수 있어요.'}
      </p>
    </form>
  );
}
