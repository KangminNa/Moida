'use client';

import { useState } from 'react';
import type { AdminApp } from '../../../_blog/types';
import { CommunityDecisions } from './CommunityDecisions';
import { CommunityMembers } from './CommunityMembers';
import { CommunityReports } from './CommunityReports';
import { CommunityTerms } from './CommunityTerms';
import { CommunityTopics } from './CommunityTopics';

type View = 'reports' | 'topics' | 'members' | 'terms' | 'decisions';

const VIEWS: Record<View, string> = {
  reports: '신고',
  topics: '글',
  members: '회원',
  terms: '약관',
  decisions: '기록',
};

// 앱 관리 › 커뮤니티 (스토어 3-2, 3-1c 관리 API): 신고 · 글 · 회원 · 약관(3-4) · 결정 기록. 회원의 글 삭제 · 제재는 관리자의 결정으로만
// (원칙 7 · 10). 시스템은 신고가 3건 쌓이면 임시로 가리기만 하고, 알림이 이 탭(?tab=community)으로 온다
export function AppCommunityTab({ app }: { app: AdminApp }) {
  const [view, setView] = useState<View>('reports');
  return (
    <>
      <nav className="row" aria-label="커뮤니티">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <button
            key={v}
            type="button"
            className="chip"
            aria-pressed={v === view}
            onClick={() => setView(v)}
          >
            {VIEWS[v]}
          </button>
        ))}
      </nav>
      {view === 'reports' && <CommunityReports appId={app.id} />}
      {view === 'topics' && <CommunityTopics appId={app.id} />}
      {view === 'members' && <CommunityMembers appId={app.id} />}
      {view === 'terms' && <CommunityTerms appId={app.id} />}
      {view === 'decisions' && <CommunityDecisions appId={app.id} />}
    </>
  );
}
