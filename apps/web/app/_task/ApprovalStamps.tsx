'use client';

import { useMe } from '../_account/live';
import type { Approval } from './types';

const SEALS: Record<string, string> = {
  approved: '승인',
  rejected: '반려',
  revision_requested: '수정',
  cancelled: '취소',
};

/** 승인선: 요청 → 승인. 승인 칸에는 승인하는 사람(관리자)의 이름 */
export function Stamps({ approval, requester }: { approval: Approval; requester: string }) {
  const seal = SEALS[approval.status];
  const decider = useMe().data?.name ?? '관리자';
  return (
    <div
      className="stamps"
      role="img"
      aria-label={`요청 ${requester}, 승인 ${decider} ${seal ?? '대기'}`}
    >
      <div className="stamp-cell">
        <span>요청</span>
        <div>{requester}</div>
      </div>
      <div className="stamp-cell">
        <span>승인 · {decider}</span>
        <div>
          <span className={seal ? 'seal' : 'seal blank'}>{seal ?? '대기'}</span>
        </div>
      </div>
    </div>
  );
}
