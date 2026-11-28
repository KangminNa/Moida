'use client';

import { useState } from 'react';
import { StoreAppLogins } from '../../_blog/StoreJoin';
import type { PublicApp } from '../../_blog/types';
import { agreedVersions, TermsAgree } from '../../_community/TermsAgree';
import type { AccountSelf, Term } from '../../_community/types';
import { type ApiReply, api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';

/** 비밀번호 확인이 다를 때: 서버에 보내지 않는다 */
const MISMATCH: ApiReply<AccountSelf> = {
  ok: false,
  status: 0,
  error: { code: 'mismatch', message: '비밀번호 확인이 맞지 않아요' },
};

// 스토어 가입 칸 (2026-11-26): 앱의 가입(/_/join)과 같은 칸에서 닉네임만 뺐다 (닉네임은 앱마다, 앱에 처음 들어갈 때 정한다).
// 메일 → "코드 받기" → 6자리 · 아이디 · 비밀번호 · 만 14세 확인 · 공통 약관 동의. 가입한 메일이어도 답은 같다 (그 메일로 안내가 간다).
// 끝나면 로그인하지 않은 채 "로그인할 앱" 목록을 보인다: 회원 로그인은 앱 도메인에서만 열린다
export function StoreJoinPanel({
  apps,
  terms,
  privacy,
}: {
  apps: readonly PublicApp[];
  terms: Term | null;
  privacy: Term | null;
}) {
  const [email, setEmail] = useState('');
  const [loginId, setLoginId] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [adult, setAdult] = useState(false);
  /** 소식 메일 받기 (선택, 2026-11-27): 체크하지 않아도 가입한다 */
  const [news, setNews] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [joined, setJoined] = useState<AccountSelf | null>(null);
  const action = useAction();
  const sending = useAction();
  const busy = action.busy !== null;
  const agree = { terms, privacy, appTerms: null, appPrivacy: null };

  if (apps.length === 0)
    return <p className="member-hint">아직 회원을 받는 앱이 없어 가입을 받지 않아요</p>;
  if (joined)
    return (
      <div className="member-form">
        <p className="member-done" role="status">
          가입했어요 · {joined.loginId}
        </p>
        <p className="member-hint">
          계정 하나로 아래 앱 어디서나 로그인해요. 앱에 처음 들어갈 때 그 앱에서 쓸 닉네임을 정해요
        </p>
        <StoreAppLogins apps={apps} />
      </div>
    );

  async function sendCode() {
    const reply = await sending.run('code', () =>
      api<null>('POST', '/api/store/join/code', { email }),
    );
    if (reply?.ok) setSentTo(email.trim());
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const reply = await action.run('join', () =>
      password !== again
        ? Promise.resolve(MISMATCH)
        : api<AccountSelf>('POST', '/api/store/join', {
            email,
            code,
            loginId,
            password,
            ageConfirmed: adult,
            newsMail: news,
            ...agreedVersions(agree, true),
          }),
    );
    if (reply?.ok) setJoined(reply.data);
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
        <small>10자 이상. 메일 · 아이디와 다르게</small>
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
      <label className="member-check">
        <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
        <span>만 14세 이상이에요</span>
      </label>
      {terms && privacy ? (
        <TermsAgree terms={agree} store agreed={agreed} onChange={setAgreed} />
      ) : (
        <p className="error">
          아직 약관이 공개되지 않아 가입을 받지 않아요. 운영자가 약관을 공개하면 가입할 수 있어요
        </p>
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
        disabled={busy || code.length !== 6 || !loginId || !password || !again || !adult || !agreed}
      >
        {busy ? '가입하는 중' : '가입'}
      </button>
      <p className="member-hint">이미 가입했으면 아래 앱에서 같은 계정으로 로그인해요</p>
      <StoreAppLogins apps={apps} />
    </form>
  );
}
