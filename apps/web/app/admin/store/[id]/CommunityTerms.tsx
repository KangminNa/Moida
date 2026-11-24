'use client';

import { formatDate } from '../../../_blog/format';
import { TERM_LABELS } from '../../../_community/labels';
import { COMMUNITY_TOPICS } from '../../../_community/live';
import type { TermsAdmin, TermsAdminItem } from '../../../_community/types';
import { api } from '../../../_lib/client-api';
import { useAction } from '../../../_lib/use-action';
import { useLiveValue } from '../../../_lib/use-live';
import { CommunityTermsForm } from './CommunityTermsForm';

// 회원 › 약관 (스토어 3-4): 이용약관 · 개인정보처리방침. 둘 다 공개해야 가입을 받는다.
// 고치면 새 버전이 쌓이고(지난 버전에 동의한 회원이 있어 덮지 않는다), 가입은 그때의 마지막 버전에 동의한다.
// 일꾼의 제안(설정 바꾸기 terms)은 승인에서 반영되고 여기서는 "승인해 올림"으로 보인다
export function CommunityTerms({ appId }: { appId: string }) {
  const terms = useLiveValue(
    `community-terms:${appId}`,
    () => api<TermsAdmin>('GET', `/api/community/admin/${appId}/terms`),
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
        api('POST', `/api/community/admin/${appId}/terms/${item.kind}`, {
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
    <section className="panel" aria-label="약관">
      <h2>약관</h2>
      <p className={terms.data.ready ? 'note' : 'error'}>
        {terms.data.ready
          ? '가입 화면에서 두 약관에 동의를 받아요. 고치면 그 뒤 가입하는 회원부터 새 버전에 동의해요'
          : '이용약관과 개인정보처리방침을 둘 다 공개해야 가입을 받아요. 초안의 [ ] 칸을 채워 주세요'}
      </p>
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
