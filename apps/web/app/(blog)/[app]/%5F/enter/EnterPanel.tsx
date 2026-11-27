'use client';

import { useState } from 'react';
import { memberApi } from '../../../../_community/member-api';
import { type AgreeTerms, agreedVersions, TermsAgree } from '../../../../_community/TermsAgree';
import type { AccountSelf, MemberSelf } from '../../../../_community/types';
import { useAction } from '../../../../_lib/use-action';

// 앱 참여: 로그인한 계정으로 이 앱의 닉네임을 정한다. 약관은 이 앱이 공개한 것과 (공통 약관에 아직 동의하지 않은 옛 계정이면) 공통 약관.
// 동의할 약관이 없으면 동의 칸이 없다. 다른 계정으로 바꾸려면 로그아웃
export function EnterPanel({
  base,
  csrf,
  returnTo,
  account,
  terms,
}: {
  /** 앱 화면의 뿌리 (자기 도메인 '', 공통 앱 도메인 /<앱>) */
  base: string;
  csrf: string | null;
  returnTo: string;
  account: AccountSelf;
  terms: AgreeTerms;
}) {
  const store = account.needs.includes('terms');
  const needsAgree = store || terms.appTerms !== null || terms.appPrivacy !== null;
  const [nickname, setNickname] = useState('');
  const [agreed, setAgreed] = useState(false);
  const enter = useAction();
  const out = useAction();
  const busy = enter.busy !== null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const reply = await enter.run('enter', () =>
      memberApi<MemberSelf>(csrf, 'POST', 'enter', {
        nickname,
        ...agreedVersions(terms, store),
      }),
    );
    // 바꿔치기: 뒤로 가기로 참여 화면에 돌아가지 않게 (웹 UX U1)
    if (reply?.ok) window.location.replace(returnTo);
  }

  async function logout() {
    const reply = await out.run('logout', () => memberApi(csrf, 'POST', 'logout'));
    if (reply?.ok)
      window.location.replace(`${base}/_/login?return=${encodeURIComponent(returnTo)}`);
  }

  return (
    <form className="member-form" onSubmit={submit}>
      <p className="member-hint">
        {account.loginId ?? account.email}(으)로 로그인했어요. 이 앱에서 쓸 닉네임을 정하면 바로
        참여해요.
      </p>
      <label className="field">
        <span>닉네임</span>
        <input
          className="input"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          required
        />
        <small>2~20자. 이 앱에서 보이는 이름이에요 (7일에 한 번 바꿈)</small>
      </label>
      <TermsAgree terms={terms} store={store} agreed={agreed} onChange={setAgreed} />
      {enter.problem && <p className="error">{enter.problem}</p>}
      <button className="cta" type="submit" disabled={busy || !nickname || (needsAgree && !agreed)}>
        {busy ? '참여하는 중' : '참여'}
      </button>
      {out.problem && <p className="error">{out.problem}</p>}
      <button className="ghost" type="button" onClick={logout} disabled={out.busy !== null}>
        다른 계정으로 로그인
      </button>
    </form>
  );
}
