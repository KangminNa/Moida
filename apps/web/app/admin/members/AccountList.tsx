'use client';

import { useState } from 'react';
import { formatDate } from '../../_blog/format';
import { COMMUNITY_TOPICS } from '../../_community/live';
import type { AccountLine, AccountPage, AccountSuspended } from '../../_community/types';
import { api } from '../../_lib/client-api';
import { ago } from '../../_lib/time-ago';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { CommunityPager } from '../store/[id]/CommunityPager';

/** 정지 기간 (일, null은 기한 없음) */
const SUSPEND_DAYS: readonly [number | null, string][] = [
  [7, '7일'],
  [30, '30일'],
  [null, '기한 없음'],
];
const DAY_MS = 86_400_000;
const CONFLICT = '그사이 바뀌었어요. 다시 읽었어요';

// 회원 계정 목록: 아이디 · 메일 · 참여한 앱 수 · 가입 · 마지막 접근 · 정지 · 탈퇴. 정지(모든 앱의 로그인을 막고 지금 로그인을 끝냄) · 풀기.
// 탈퇴한 계정은 메일 · 아이디가 지워져 "탈퇴한 계정"으로 보인다
export function AccountList() {
  const [cursor, setCursor] = useState<string | null>(null);
  const action = useAction();
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const accounts = useLiveValue(
    `community-accounts:${query}`,
    () => api<AccountPage>('GET', `/api/community/admin/accounts${query}`),
    COMMUNITY_TOPICS,
  );
  const items = accounts.data?.items ?? null;
  const nameOf = (a: AccountLine) => a.loginId ?? a.email ?? '탈퇴한 계정';

  function suspend(a: AccountLine, days: number | null, label: string) {
    if (!window.confirm(`${nameOf(a)} 계정을 정지할까요 (${label})? 모든 앱에서 로그인이 막혀요`))
      return;
    const until = days === null ? null : new Date(Date.now() + days * DAY_MS).toISOString();
    void action.run(
      `${a.id}:suspend`,
      () =>
        api<AccountSuspended>('POST', `/api/community/admin/accounts/${a.id}/suspend`, {
          version: a.version,
          until,
        }),
      { done: `${nameOf(a)} 정지함 (${label})`, reload: accounts.reload, conflict: CONFLICT },
    );
  }

  function unsuspend(a: AccountLine) {
    void action.run(
      `${a.id}:unsuspend`,
      () =>
        api<AccountSuspended>('POST', `/api/community/admin/accounts/${a.id}/unsuspend`, {
          version: a.version,
        }),
      { done: '정지를 풀었음', reload: accounts.reload, conflict: CONFLICT },
    );
  }

  return (
    <section className="panel stack" aria-label="회원 계정">
      <h2>회원 계정</h2>
      <p className="note">
        한 계정으로 이 사이트의 모든 앱에 가입해요. 앱마다의 닉네임 · 차단은 앱 관리의 회원 탭에서
        봐요
      </p>
      {(action.problem ?? accounts.error) && (
        <p className="error">{action.problem ?? accounts.error}</p>
      )}
      {items === null ? (
        !accounts.error && <p className="label-mono">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="rows-empty">회원 계정 없음</p>
      ) : (
        <ul className="list">
          {items.map((a) => {
            const suspended =
              a.suspendedUntil !== null && Date.parse(a.suspendedUntil) > Date.now();
            return (
              <li key={a.id} className="list-cell stack">
                <div className="item-main">
                  <b>
                    {nameOf(a)}
                    {a.loginId && a.email && <small> ({a.email})</small>}
                    {suspended && <span className="pill on">정지</span>}
                  </b>
                  <small>
                    가입 {formatDate(a.joinedAt)} · 마지막 접근{' '}
                    {a.lastSeenAt ? ago(a.lastSeenAt) : '없음'} · 참여한 앱 {a.apps}
                    {suspended && a.suspendedUntil && !a.suspendedUntil.startsWith('9999')
                      ? ` · ${formatDate(a.suspendedUntil)}까지 정지`
                      : ''}
                  </small>
                </div>
                {a.leftAt === null && (
                  <div className="row">
                    {suspended ? (
                      <button
                        type="button"
                        className="ghost small"
                        disabled={action.busy !== null}
                        onClick={() => unsuspend(a)}
                      >
                        정지 풀기
                      </button>
                    ) : (
                      SUSPEND_DAYS.map(([days, label]) => (
                        <button
                          key={label}
                          type="button"
                          className="ghost small danger"
                          disabled={action.busy !== null}
                          onClick={() => suspend(a, days, label)}
                        >
                          정지 {label}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <CommunityPager cursor={cursor} next={accounts.data?.nextCursor ?? null} onMove={setCursor} />
    </section>
  );
}
