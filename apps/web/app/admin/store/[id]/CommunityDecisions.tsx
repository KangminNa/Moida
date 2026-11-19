'use client';

import { useState } from 'react';
import { formatDate } from '../../../_blog/format';
import { DECISION_ACTION_LABELS } from '../../../_community/labels';
import { COMMUNITY_TOPICS } from '../../../_community/live';
import type { DecisionPage } from '../../../_community/types';
import { api } from '../../../_lib/client-api';
import { useLiveValue } from '../../../_lib/use-live';
import { CommunityPager } from './CommunityPager';

const TARGET: Record<string, string> = { topic: '글', comment: '댓글', member: '회원' };
const BY: Record<string, string> = { system: '신고 3건으로', owner: '관리자' };

// 커뮤니티 › 기록: 가림 · 되돌림 · 내림 · 차단 · 풀기 · 비밀번호 초기화의 기록 (추가만 하는 기록, 최근부터)
export function CommunityDecisions({ appId }: { appId: string }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const decisions = useLiveValue(
    `community-decisions:${appId}:${query}`,
    () => api<DecisionPage>('GET', `/api/community/admin/${appId}/decisions${query}`),
    COMMUNITY_TOPICS,
  );
  const items = decisions.data?.items ?? null;
  return (
    <section className="stack" aria-label="결정 기록">
      {decisions.error && <p className="error">{decisions.error}</p>}
      {items === null ? (
        !decisions.error && <p className="label-mono">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="rows-empty">기록 없음</p>
      ) : (
        <ul className="list">
          {items.map((d) => (
            <li key={d.id} className="list-cell">
              <div className="item-main">
                <b className="clamp-1">
                  {DECISION_ACTION_LABELS[d.action]} · {TARGET[d.target.kind]} {d.target.label}
                </b>
                <small>
                  {BY[d.by] ?? d.by} · {formatDate(d.createdAt)}
                  {d.note ? ` · ${d.note}` : ''}
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}
      <CommunityPager
        cursor={cursor}
        next={decisions.data?.nextCursor ?? null}
        onMove={setCursor}
      />
    </section>
  );
}
