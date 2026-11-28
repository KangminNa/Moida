'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatDate } from '../../../../_blog/format';
import { memberApi } from '../../../../_community/member-api';
import { PasswordPanel } from '../../../../_community/PasswordPanel';
import type { AccountSelf, MemberSelf } from '../../../../_community/types';
import { useAction } from '../../../../_lib/use-action';

// 내 정보: 계정(아이디 · 메일)과 이 앱 참여일, 이 앱의 닉네임 바꾸기(7일에 한 번),
// 계정 비밀번호 바꾸기(PasswordPanel, 모든 앱의 다른 로그인은 끝난다), 로그아웃.
// 동작마다 오류를 제자리에 보이게 useAction을 따로 둔다 (web 규칙)
export function MePanel({
  base,
  csrf,
  account,
  member,
  notice,
}: {
  /** 앱 화면의 뿌리 (자기 도메인 '', 공통 앱 도메인 /<앱>) */
  base: string;
  csrf: string | null;
  account: AccountSelf;
  member: MemberSelf;
  notice: string | null;
}) {
  const router = useRouter();
  const [nickname, setNickname] = useState(member.nickname);
  const rename = useAction();
  const out = useAction();

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    await rename.run(
      'rename',
      () => memberApi(csrf, 'PATCH', 'me', { version: member.version, nickname }),
      { reload: () => router.refresh(), conflict: '다른 곳에서 바뀌었어요. 다시 해 주세요' },
    );
  }

  async function logout() {
    const reply = await out.run('logout', () => memberApi(csrf, 'POST', 'logout'));
    if (reply?.ok) window.location.replace(`${base}/`);
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

      <PasswordPanel csrf={csrf} />

      {out.problem && <p className="error">{out.problem}</p>}
      <button className="ghost" type="button" onClick={logout} disabled={out.busy !== null}>
        로그아웃
      </button>
    </div>
  );
}
