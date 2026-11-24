'use client';

import { useState } from 'react';
import { formatDate } from '../../../_blog/format';
import {
  CONTENT_STATE_LABELS,
  REPORT_REASON_LABELS,
  REPORT_STATE_LABELS,
} from '../../../_community/labels';
import { COMMUNITY_TOPICS } from '../../../_community/live';
import type { AdminReport, AdminReportPage } from '../../../_community/types';
import { api } from '../../../_lib/client-api';
import { useAction } from '../../../_lib/use-action';
import { useLiveValue } from '../../../_lib/use-live';
import { CommunityContentActions } from './CommunityContentActions';
import { CommunityOpinion } from './CommunityOpinion';
import { CommunityPager } from './CommunityPager';

type ReportState = AdminReport['state'];

// 커뮤니티 › 신고: 기본은 열린 신고 (최근부터 30건). 대상(글 · 댓글)과 까닭 · 메모 · 신고한 회원의 닉네임, 대상에 바로 결정한다.
// 같은 대상에 신고가 여럿이면 줄마다 보이고, 하나를 정하면 그 대상의 열린 신고가 모두 닫힌다.
// 일꾼의 검토 제안이 있으면 줄에 AI 의견으로 보이고 여기서 승인한다 (3-3)
export function CommunityReports({ appId }: { appId: string }) {
  const [state, setState] = useState<ReportState>('open');
  const [cursor, setCursor] = useState<string | null>(null);
  const action = useAction();
  const query = new URLSearchParams({ state, ...(cursor ? { cursor } : {}) });
  const reports = useLiveValue(
    `community-reports:${appId}:${query}`,
    () => api<AdminReportPage>('GET', `/api/community/admin/${appId}/reports?${query}`),
    COMMUNITY_TOPICS,
  );
  const items = reports.data?.items ?? null;

  return (
    <section className="stack" aria-label="신고">
      <div className="row">
        {(Object.keys(REPORT_STATE_LABELS) as ReportState[]).map((s) => (
          <button
            key={s}
            type="button"
            className="chip"
            aria-pressed={s === state}
            onClick={() => {
              setState(s);
              setCursor(null);
            }}
          >
            {REPORT_STATE_LABELS[s]}
          </button>
        ))}
      </div>
      {(action.problem ?? reports.error) && (
        <p className="error">{action.problem ?? reports.error}</p>
      )}
      {items === null ? (
        !reports.error && <p className="label-mono">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="rows-empty">{state === 'open' ? '열린 신고 없음' : '신고 없음'}</p>
      ) : (
        <ul className="list">
          {items.map((r) => (
            <li key={r.id} className="list-cell stack">
              <div className="item-main">
                <b className="clamp-1">
                  {r.target.kind === 'topic' ? '글' : '댓글'} · {r.target.topicTitle}
                </b>
                {r.target.kind === 'comment' && <small>{r.target.excerpt}</small>}
                <small>
                  {REPORT_REASON_LABELS[r.reason]} · 신고 {r.reporter.nickname} · 쓴 회원{' '}
                  {r.target.author.nickname}({r.target.author.loginId ?? '탈퇴'}) ·{' '}
                  {CONTENT_STATE_LABELS[r.target.state]} · {formatDate(r.createdAt)}
                </small>
                {r.note && <small>메모: {r.note}</small>}
              </div>
              {r.state === 'open' && r.target.id && (
                <CommunityOpinion
                  targetIds={[r.target.id, r.target.author.id]}
                  reload={reports.reload}
                />
              )}
              {r.state === 'open' && r.target.id && (
                <CommunityContentActions
                  appId={appId}
                  kind={r.target.kind === 'topic' ? 'topic' : 'comment'}
                  id={r.target.id}
                  state={r.target.state}
                  version={r.target.version}
                  action={action}
                  reload={reports.reload}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <CommunityPager cursor={cursor} next={reports.data?.nextCursor ?? null} onMove={setCursor} />
    </section>
  );
}
