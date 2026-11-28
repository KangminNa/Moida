'use client';

import { useRouter } from 'next/navigation';
import { useAction } from '../_lib/use-action';
import { accountApi } from './member-api';
import type { AccountSelf } from './types';

// 소식 메일 받기 (2026-11-27): 가입 때 고른 선택 동의를 내 정보에서 켜고 끈다. 메일이 없는 옛 계정은 메일을 먼저 등록한다.
// 끄면 그 뒤로 소식 메일이 가지 않는다 (메일마다 있는 수신 거부 링크와 같다)
// 앱의 내 정보와 공통 앱 도메인의 앱 없는 내 정보(shared, 2026-11-28)가 함께 쓴다
export function NewsMail({
  csrf,
  account,
  shared = false,
}: {
  csrf: string | null;
  account: AccountSelf;
  shared?: boolean;
}) {
  const router = useRouter();
  const call = accountApi(shared);
  const saving = useAction();
  if (!account.email) return null;

  async function toggle() {
    await saving.run(
      'news',
      () =>
        call(csrf, 'PUT', 'account/news', {
          version: account.version,
          agreed: !account.newsMail,
        }),
      { reload: () => router.refresh() },
    );
  }

  return (
    <section className="member-form" aria-label="소식 메일">
      <label className="member-check">
        <input
          type="checkbox"
          checked={account.newsMail}
          disabled={saving.busy !== null}
          onChange={toggle}
        />
        <span>
          (선택) 소식 메일 받기
          <small className="member-hint">
            새 앱 · 소식 같은 광고성 메일이에요. 받는 곳: {account.email}
          </small>
        </span>
      </label>
      {saving.problem && <p className="error">{saving.problem}</p>}
    </section>
  );
}
