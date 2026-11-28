'use client';

import { storeApi } from '../../_community/member-api';
import type { AccountSelf } from '../../_community/types';
import { useAction } from '../../_lib/use-action';

// 앱 없는 내 정보의 머리 (2026-11-28): 계정의 아이디 · 메일과 로그아웃 (이 도메인의 모든 앱에서 로그아웃).
// 아이디 · 메일이 없는 옛 계정의 채우기는 앱의 내 정보에서 한다
export function StoreMePanel({ csrf, account }: { csrf: string | null; account: AccountSelf }) {
  const out = useAction();

  async function logout() {
    const reply = await out.run('logout', () => storeApi(csrf, 'POST', 'logout'));
    // 바꿔치기: 뒤로 가기로 내 정보에 돌아가지 않게 (웹 UX U1)
    if (reply?.ok) window.location.replace('/');
  }

  return (
    <div className="member-form">
      <dl className="member-facts">
        <dt>아이디</dt>
        <dd>{account.loginId ?? '아직 없어요'}</dd>
        <dt>메일</dt>
        <dd>{account.email ?? '아직 없어요'}</dd>
      </dl>
      {(!account.loginId || !account.email) && (
        <p className="member-hint">빈 칸은 앱의 내 정보에서 채워요</p>
      )}
      {out.problem && <p className="error">{out.problem}</p>}
      <button className="ghost" type="button" onClick={logout} disabled={out.busy !== null}>
        로그아웃
      </button>
    </div>
  );
}
