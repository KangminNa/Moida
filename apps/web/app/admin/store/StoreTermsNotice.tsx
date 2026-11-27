'use client';

import Link from 'next/link';
import { COMMUNITY_TOPICS } from '../../_community/live';
import type { TermsAdmin } from '../../_community/types';
import { api } from '../../_lib/client-api';
import { useLiveValue } from '../../_lib/use-live';

// 내 앱 맨 위: 공통 약관이 없으면 회원 가입을 받지 못한다는 안내 (2026-11-27, 사용자 "약관이 없다고 회원가입이 안 되던데?").
// 가입은 개인정보처리방침이 공개돼야 받는다 (개인정보보호법 제30조 · 제22조): 막는 규칙은 그대로 두고, 관리자가 알 수 있게 한다.
// 초안은 이미 채워져 있어 회원 계정 화면에서 [ ] 안만 채우고 공개하면 된다. 다 공개됐으면 아무것도 보이지 않는다
export function StoreTermsNotice() {
  const terms = useLiveValue(
    'community-terms:store',
    () => api<TermsAdmin>('GET', '/api/community/admin/terms'),
    COMMUNITY_TOPICS,
  );
  if (!terms.data || terms.data.ready) return null;
  const missing = terms.data.items
    .filter((i) => i.current === null)
    .map((i) => (i.kind === 'terms' ? '이용약관' : '개인정보처리방침'))
    .join(' · ');
  return (
    <div className="warn row store-terms-warn">
      <div className="item-main">
        <b>회원 가입을 받지 않는 중</b>
        <small>
          {missing}이 아직 공개되지 않았어요. 초안이 채워져 있으니 운영자 이름 · 연락처 · 시행일을
          채워 공개하면 가입을 받아요
        </small>
      </div>
      <Link className="cta small" href="/admin/members">
        약관 공개하기
      </Link>
    </div>
  );
}
