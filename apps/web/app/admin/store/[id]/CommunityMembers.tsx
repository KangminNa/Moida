'use client';

import { useState } from 'react';
import { formatDate } from '../../../_blog/format';
import { COMMUNITY_TOPICS } from '../../../_community/live';
import type { AdminMember, AdminMemberPage, MemberReset } from '../../../_community/types';
import { api } from '../../../_lib/client-api';
import { useAction } from '../../../_lib/use-action';
import { useLiveValue } from '../../../_lib/use-live';
import { CommunityPager } from './CommunityPager';

/** 차단 기간 (일, null은 기한 없음) */
const BLOCK_DAYS: readonly [number | null, string][] = [
  [1, '1일'],
  [7, '7일'],
  [30, '30일'],
  [null, '기한 없음'],
];
const DAY_MS = 86_400_000;
const CONFLICT = '그사이 바뀌었어요. 다시 읽었어요';

// 커뮤니티 › 회원: 아이디 · 닉네임 · 가입 · 마지막 접근 · 쓴 수 · 차단. 차단(기간) · 풀기 · 비밀번호 초기화.
// 임시 비밀번호는 초기화한 답에만 있어 이 화면에 한 번 보이고 닫으면 다시 볼 수 없다 (회원에게 직접 전한다)
export function CommunityMembers({ appId }: { appId: string }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [reset, setReset] = useState<MemberReset | null>(null);
  const action = useAction();
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const members = useLiveValue(
    `community-members:${appId}:${query}`,
    () => api<AdminMemberPage>('GET', `/api/community/admin/${appId}/members${query}`),
    COMMUNITY_TOPICS,
  );
  const items = members.data?.items ?? null;
  const base = `/api/community/admin/${appId}/members`;

  function block(m: AdminMember, days: number | null, label: string) {
    const note = window.prompt(`${m.nickname} 차단 (${label}): 메모 (선택)`, '');
    if (note === null) return;
    const until = days === null ? null : new Date(Date.now() + days * DAY_MS).toISOString();
    void action.run(
      `${m.id}:block`,
      () => api('POST', `${base}/${m.id}/block`, { version: m.version, until, note }),
      { done: `${m.nickname} 차단함 (${label})`, reload: members.reload, conflict: CONFLICT },
    );
  }

  function unblock(m: AdminMember) {
    if (!window.confirm(`${m.nickname}의 차단을 풀까요?`)) return;
    void action.run(
      `${m.id}:unblock`,
      () => api('POST', `${base}/${m.id}/unblock`, { version: m.version }),
      { done: '차단을 풀었음', reload: members.reload, conflict: CONFLICT },
    );
  }

  async function resetPassword(m: AdminMember) {
    if (!window.confirm(`${m.nickname}의 비밀번호를 초기화할까요? 그 회원의 모든 로그인이 끝나요`))
      return;
    const reply = await action.run(
      `${m.id}:reset`,
      () => api<MemberReset>('POST', `${base}/${m.id}/reset-password`, { version: m.version }),
      { reload: members.reload, conflict: CONFLICT },
    );
    if (reply?.ok) setReset(reply.data);
  }

  return (
    <section className="stack" aria-label="회원">
      {reset && (
        <div className="panel stack" role="status">
          <b>{reset.loginId}의 임시 비밀번호</b>
          <code className="community-secret">{reset.password}</code>
          <small>
            이 화면을 닫으면 다시 볼 수 없어요. 회원에게 직접 전하고, 로그인한 뒤 바꾸게 해 주세요
          </small>
          <div className="row">
            <button
              type="button"
              className="ghost small"
              onClick={() => void navigator.clipboard?.writeText(reset.password)}
            >
              복사
            </button>
            <button type="button" className="ghost small" onClick={() => setReset(null)}>
              닫기
            </button>
          </div>
        </div>
      )}
      {(action.problem ?? members.error) && (
        <p className="error">{action.problem ?? members.error}</p>
      )}
      {items === null ? (
        !members.error && <p className="label-mono">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="rows-empty">회원 없음</p>
      ) : (
        <ul className="list">
          {items.map((m) => {
            const blocked = m.blockedUntil !== null && Date.parse(m.blockedUntil) > Date.now();
            return (
              <li key={m.id} className="list-cell stack">
                <div className="item-main">
                  <b>
                    {m.nickname} <small>({m.loginId})</small>
                    {blocked && <span className="pill on">차단</span>}
                  </b>
                  <small>
                    가입 {formatDate(m.joinedAt)} · 마지막 접근 {formatDate(m.lastSeenAt)} · 글{' '}
                    {m.topics} · 댓글 {m.comments}
                    {blocked && m.blockedUntil && !m.blockedUntil.startsWith('9999')
                      ? ` · ${formatDate(m.blockedUntil)}까지 차단`
                      : ''}
                  </small>
                </div>
                <div className="row">
                  {blocked ? (
                    <button
                      type="button"
                      className="ghost small"
                      disabled={action.busy !== null}
                      onClick={() => unblock(m)}
                    >
                      차단 풀기
                    </button>
                  ) : (
                    BLOCK_DAYS.map(([days, label]) => (
                      <button
                        key={label}
                        type="button"
                        className="ghost small danger"
                        disabled={action.busy !== null}
                        onClick={() => block(m, days, label)}
                      >
                        차단 {label}
                      </button>
                    ))
                  )}
                  <button
                    type="button"
                    className="ghost small"
                    disabled={action.busy !== null}
                    onClick={() => void resetPassword(m)}
                  >
                    비밀번호 초기화
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <CommunityPager cursor={cursor} next={members.data?.nextCursor ?? null} onMove={setCursor} />
    </section>
  );
}
