'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { memberApi } from '../../../../_community/member-api';
import type { AccountSelf } from '../../../../_community/types';
import { useAction } from '../../../../_lib/use-action';

// 옮겨 온 옛 계정의 빈 칸 채우기 (스토어 계정, 2026-11-26): 아이디가 없으면 아이디를 한 번 정하고,
// 메일이 없으면 인증코드로 메일을 등록한다 (비밀번호를 잊었을 때 메일로 다시 정할 수 있게). 채울 것이 없으면 그리지 않는다
export function AccountFill({ csrf, account }: { csrf: string | null; account: AccountSelf }) {
  const router = useRouter();
  const [loginId, setLoginId] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const saveId = useAction();
  const sending = useAction();
  const saveMail = useAction();
  const needsId = account.needs.includes('loginId');
  const needsMail = account.needs.includes('email');
  if (!needsId && !needsMail) return null;

  async function submitId(event: React.FormEvent) {
    event.preventDefault();
    await saveId.run(
      'login-id',
      () => memberApi(csrf, 'PUT', 'account/login-id', { version: account.version, loginId }),
      { reload: () => router.refresh(), conflict: '이미 쓰는 아이디예요' },
    );
  }

  async function sendCode() {
    const reply = await sending.run('code', () =>
      memberApi<null>(csrf, 'POST', 'account/email/code', { email }),
    );
    if (reply?.ok) setSentTo(email.trim());
  }

  async function submitMail(event: React.FormEvent) {
    event.preventDefault();
    await saveMail.run('email', () => memberApi(csrf, 'PUT', 'account/email', { email, code }), {
      reload: () => router.refresh(),
    });
  }

  return (
    <div className="member-form">
      {needsId && (
        <form className="member-form" onSubmit={submitId} aria-label="아이디 정하기">
          <label className="field">
            <span>아이디 정하기</span>
            <input
              className="input"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value.toLowerCase())}
              autoCapitalize="none"
              spellCheck={false}
              required
            />
            <small>영문 소문자로 시작하는 4~20자. 한 번 정하면 바꾸지 않아요</small>
          </label>
          {saveId.problem && <p className="error">{saveId.problem}</p>}
          <button className="ghost" type="submit" disabled={saveId.busy !== null || !loginId}>
            아이디 정하기
          </button>
        </form>
      )}
      {needsMail && (
        <form className="member-form" onSubmit={submitMail} aria-label="메일 등록">
          <label className="field">
            <span>메일 등록</span>
            <span className="member-inline">
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                ? `${sentTo}로 6자리 코드를 보냈어요 (10분)`
                : '비밀번호를 잊었을 때 메일로 다시 정할 수 있어요'}
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
          {saveMail.problem && <p className="error">{saveMail.problem}</p>}
          <button
            className="ghost"
            type="submit"
            disabled={saveMail.busy !== null || code.length !== 6}
          >
            메일 등록
          </button>
        </form>
      )}
    </div>
  );
}
