'use client';

import { useState } from 'react';
import { formatDate } from '../../../_blog/format';
import { CONTENT_STATE_LABELS } from '../../../_community/labels';
import { COMMUNITY_TOPICS } from '../../../_community/live';
import type { AdminTopic, AdminTopicLine, AdminTopicPage } from '../../../_community/types';
import { api } from '../../../_lib/client-api';
import { useAction } from '../../../_lib/use-action';
import { useLiveValue } from '../../../_lib/use-live';
import { CommunityContentActions } from './CommunityContentActions';
import { CommunityPager } from './CommunityPager';

type State = AdminTopicLine['state'];

/** 가린 까닭 */
const HIDDEN_BY: Record<string, string> = { reports: '신고 3건', owner: '관리자' };

// 커뮤니티 › 글: 모든 상태의 글 (상태로 거른다, 최근부터 30개). 글을 열면 본문 전체와 모든 댓글이 보이고 각각에 결정한다
export function CommunityTopics({ appId }: { appId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const action = useAction();
  const query = new URLSearchParams({ ...(state ? { state } : {}), ...(cursor ? { cursor } : {}) });
  const topics = useLiveValue(
    `community-topics:${appId}:${query}`,
    () => api<AdminTopicPage>('GET', `/api/community/admin/${appId}/topics?${query}`),
    COMMUNITY_TOPICS,
  );
  const items = topics.data?.items ?? null;
  const filters: readonly [State | null, string][] = [
    [null, '전체'],
    ...(Object.entries(CONTENT_STATE_LABELS) as [State, string][]),
  ];

  return (
    <section className="stack" aria-label="글">
      <div className="row">
        {filters.map(([value, label]) => (
          <button
            key={label}
            type="button"
            className="chip"
            aria-pressed={value === state}
            onClick={() => {
              setState(value);
              setCursor(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {(action.problem ?? topics.error) && (
        <p className="error">{action.problem ?? topics.error}</p>
      )}
      {items === null ? (
        !topics.error && <p className="label-mono loading">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="rows-empty">글 없음</p>
      ) : (
        <ul className="list">
          {items.map((t) => (
            <li key={t.id} className="list-cell stack">
              <button
                type="button"
                className="item-main"
                aria-expanded={open === t.id}
                onClick={() => setOpen(open === t.id ? null : t.id)}
              >
                <b className="clamp-1">{t.title}</b>
                <small>
                  {CONTENT_STATE_LABELS[t.state]}
                  {t.hiddenBy ? ` (${HIDDEN_BY[t.hiddenBy] ?? t.hiddenBy})` : ''} ·{' '}
                  {t.author.nickname}({t.author.loginId ?? '탈퇴'}) · 댓글 {t.comments}
                  {t.openReports > 0 ? ` · 열린 신고 ${t.openReports}` : ''} ·{' '}
                  {formatDate(t.createdAt)}
                </small>
              </button>
              {open === t.id && (
                <TopicDetail appId={appId} id={t.id} action={action} onDecided={topics.reload} />
              )}
            </li>
          ))}
        </ul>
      )}
      <CommunityPager cursor={cursor} next={topics.data?.nextCursor ?? null} onMove={setCursor} />
    </section>
  );
}

/** 글 하나: 본문(글자 그대로) · 버전 수 · 모든 댓글과 결정 단추 */
function TopicDetail({
  appId,
  id,
  action,
  onDecided,
}: {
  appId: string;
  id: string;
  action: ReturnType<typeof useAction>;
  onDecided: () => Promise<void>;
}) {
  const topic = useLiveValue(
    `community-topic:${appId}:${id}`,
    () => api<AdminTopic>('GET', `/api/community/admin/${appId}/topics/${id}`),
    COMMUNITY_TOPICS,
  );
  const t = topic.data;
  if (!t)
    return topic.error ? (
      <p className="error">{topic.error}</p>
    ) : (
      <p className="label-mono loading">불러오는 중…</p>
    );
  const reload = () => Promise.all([topic.reload(), onDecided()]);
  return (
    <div className="stack">
      <p className="community-body">{t.body}</p>
      <small>
        버전 {t.revisions}
        {t.editedAt ? ` · 고침 ${formatDate(t.editedAt)}` : ''}
        {t.decidedAt ? ` · 마지막 결정 ${formatDate(t.decidedAt)}` : ''}
      </small>
      <CommunityContentActions
        appId={appId}
        kind="topic"
        id={t.id}
        state={t.state}
        version={t.version}
        action={action}
        reload={reload}
      />
      {t.comments.length > 0 && (
        <ul className="list" aria-label="댓글">
          {t.comments.map((c) => (
            <li key={c.id} className="list-cell stack">
              <p className="community-body">{c.body}</p>
              <small>
                {c.author.nickname}({c.author.loginId ?? '탈퇴'}) · {CONTENT_STATE_LABELS[c.state]}
                {c.openReports > 0 ? ` · 열린 신고 ${c.openReports}` : ''} ·{' '}
                {formatDate(c.createdAt)}
              </small>
              <CommunityContentActions
                appId={appId}
                kind="comment"
                id={c.id}
                state={c.state}
                version={c.version}
                action={action}
                reload={reload}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
