'use client';

import { formatDate } from '../../../_blog/format';
import { TERM_LABELS } from '../../../_community/labels';
import { COMMUNITY_TOPICS } from '../../../_community/live';
import type { TermsAdmin, TermsAdminItem } from '../../../_community/types';
import { api } from '../../../_lib/client-api';
import { useAction } from '../../../_lib/use-action';
import { useLiveValue } from '../../../_lib/use-live';
import { CommunityTermsForm } from './CommunityTermsForm';

// 약관 (스토어 3-4, 스토어 계정 2026-11-26): 이용약관 · 개인정보처리방침.
// appId가 null이면 공통 약관(설정 › 회원 계정): 둘 다 공개해야 가입을 받고, 모든 앱의 가입에서 동의를 받는다.
// 앱의 약관(회원 › 약관)은 공개했을 때만 그 앱에 참여할 때 더 동의한다 (없어도 된다).
// 고치면 새 버전이 쌓이고(지난 버전에 동의한 회원이 있어 덮지 않는다), 가입 · 참여는 그때의 마지막 버전에 동의한다.
// 일꾼의 제안(설정 바꾸기 terms, 앱의 약관만)은 승인에서 반영되고 여기서는 "승인해 올림"으로 보인다
export function CommunityTerms({ appId }: { appId: string | null }) {
  const base =
    appId === null ? '/api/community/admin/terms' : `/api/community/admin/${appId}/terms`;
  const terms = useLiveValue(
    `community-terms:${appId ?? 'store'}`,
    () => api<TermsAdmin>('GET', base),
    COMMUNITY_TOPICS,
  );
  // 약관마다 저장의 오류를 그 자리에 보이게 동작을 따로 둔다
  const termsAction = useAction();
  const privacyAction = useAction();

  function publish(item: TermsAdminItem, body: string) {
    const action = item.kind === 'terms' ? termsAction : privacyAction;
    const label = TERM_LABELS[item.kind];
    const first = item.current === null;
    if (
      !first &&
      !window.confirm(
        `${label}을 새 버전으로 공개할까요? 지난 버전에 동의한 회원도 있어 지난 버전은 그대로 남아요`,
      )
    )
      return;
    void action.run(
      item.kind,
      () =>
        api('POST', `${base}/${item.kind}`, {
          version: item.current?.version ?? 0,
          body,
        }),
      {
        done: `${label} 공개함`,
        reload: terms.reload,
        conflict: '그사이 새 버전이 올라왔어요. 다시 읽었어요',
      },
    );
  }

  if (terms.error && !terms.data) return <p className="error">{terms.error}</p>;
  if (!terms.data) return <p className="note">읽는 중</p>;
  return (
    <section className="panel" aria-label={appId === null ? '공통 약관' : '약관'}>
      <h2>{appId === null ? '공통 약관' : '이 앱의 약관'}</h2>
      {appId === null ? (
        <p className={terms.data.ready ? 'note' : 'error'}>
          {terms.data.ready
            ? '모든 앱의 가입 화면에서 동의를 받아요. 고치면 그 뒤 가입하는 회원부터 새 버전에 동의해요'
            : '이용약관과 개인정보처리방침을 둘 다 공개해야 가입을 받아요. 초안의 [ ] 칸을 채워 주세요'}
        </p>
      ) : (
        <p className="note">
          가입은 설정 › 회원 계정의 공통 약관으로 받아요. 이 앱만의 약관이 필요하면 공개하세요: 이
          앱에 참여할 때 함께 동의를 받아요
        </p>
      )}
      {terms.data.items.map((item) => {
        const action = item.kind === 'terms' ? termsAction : privacyAction;
        return (
          <div key={item.kind} className="stack">
            <h3>
              {TERM_LABELS[item.kind]}{' '}
              <span className="label-mono">
                {item.current
                  ? `버전 ${item.current.version} · ${formatDate(item.current.publishedAt)}${item.current.approved ? ' · 제안을 승인해 올림' : ''}`
                  : '공개 전'}
              </span>
            </h3>
            <CommunityTermsForm
              key={`${item.kind}:${item.current?.version ?? 0}`}
              initial={item.current?.body ?? item.draft}
              first={item.current === null}
              busy={action.busy !== null}
              problem={action.problem}
              onSubmit={(body) => publish(item, body)}
            />
          </div>
        );
      })}
    </section>
  );
}
