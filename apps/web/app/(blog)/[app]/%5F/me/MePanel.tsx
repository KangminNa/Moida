'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatDate } from '../../../../_blog/format';
import { memberApi } from '../../../../_community/member-api';
import type { AccountSelf, MemberSelf } from '../../../../_community/types';
import type { ApiReply } from '../../../../_lib/client-api';
import { useAction } from '../../../../_lib/use-action';

const MISMATCH: ApiReply<null> = {
  ok: false,
  status: 0,
  error: { code: 'mismatch', message: '새 비밀번호 확인이 맞지 않아요' },
};

// 내 정보: 계정(아이디 · 메일)과 이 앱 참여일, 이 앱의 닉네임 바꾸기(7일에 한 번),
// 계정 비밀번호 바꾸기(모든 앱의 다른 로그인은 끝난다), 로그아웃.
// 동작마다 오류를 제자리에 보이게 useAction을 따로 둔다 (web 규칙)
export function MePanel({
  csrf,
  account,
  member,
  notice,
}: {
  csrf: string | null;
  account: AccountSelf;
  member: MemberSelf;
  notice: string | null;
}) {
  const router = useRouter();
  const [nickname, setNickname] = useState(member.nickname);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [changed, setChanged] = useState(false);
  const rename = useAction();
  const password = useAction();
  const out = useAction();

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    await rename.run(
      'rename',
      () => memberApi(csrf, 'PATCH', 'me', { version: member.version, nickname }),
      { reload: () => router.refresh(), conflict: '다른 곳에서 바뀌었어요. 다시 해 주세요' },
    );
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    const reply = await password.run('password', () =>
      next !== again
        ? Promise.resolve(MISMATCH)
        : memberApi<null>(csrf, 'PATCH', 'me/password', { current, next }),
    );
    if (!reply?.ok) return;
    setCurrent('');
    setNext('');
    setAgain('');
    setChanged(true);
  }

  async function logout() {
    const reply = await out.run('logout', () => memberApi(csrf, 'POST', 'logout'));
    if (reply?.ok) window.location.replace('/');
  }

  return (
    <div className="member-form">
      {notice && <p className="note">{notice}</p>}
      <dl className="member-facts">
        <dt>아이디</dt>
        <dd>{account.loginId ?? '아직 없어요'}</dd>
        <dt>메일</dt>
        <dd>{account.email ?? '아직 없어요'}</dd>
        <dt>이 앱 참여</dt>
        <dd>{formatDate(member.joinedAt)}</dd>
      </dl>

      <form className="member-form" onSubmit={saveName} aria-label="닉네임 바꾸기">
        <label className="field">
          <span>닉네임</span>
          <input
            className="input"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            required
          />
          <small>7일에 한 번 바꿀 수 있어요</small>
        </label>
        {rename.problem && <p className="error">{rename.problem}</p>}
        <button
          className="ghost"
          type="submit"
          disabled={rename.busy !== null || nickname.trim() === member.nickname}
        >
          {rename.busy ? '바꾸는 중' : '닉네임 바꾸기'}
        </button>
      </form>

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

      {out.problem && <p className="error">{out.problem}</p>}
      <button className="ghost" type="button" onClick={logout} disabled={out.busy !== null}>
        로그아웃
      </button>
    </div>
  );
}
