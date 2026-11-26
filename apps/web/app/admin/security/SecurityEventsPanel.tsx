'use client';

import { useRef, useState } from 'react';
import { useLiveValue } from '../../_lib/use-live';
import {
  browserOf,
  SECURITY_GROUPS,
  SECURITY_KINDS,
  securityAlert,
  securityDetail,
} from '../../_platform/labels';
import type { SecurityEventPage } from '../../_platform/types';
import { when } from '../../_task/labels';
import { readPages } from '../../_task/live';

const mergePages = (before: SecurityEventPage, more: SecurityEventPage): SecurityEventPage => ({
  events: [...before.events, ...more.events],
  next: more.next,
});

// 보안 기록 (최근부터, 90일): 로그인 시도 · 로그아웃 · 기기 · 거부된 접근. 1분 안의 같은 사건은 한 줄에 "N번".
// 변경 신호가 없어 처음 · 다시 연결될 때 · "새로 읽기"로 읽는다.
export function SecurityEventsPanel() {
  const [group, setGroup] = useState('');
  /** 읽어 둔 쪽 수. 거르기를 바꾸면 처음으로 */
  const pages = useRef(1);
  const path = group ? `/api/security/events?group=${group}` : '/api/security/events';
  const list = useLiveValue(path, () => readPages(path, pages.current, mergePages), []);
  const page = list.data;

  function more() {
    pages.current += 1;
    void list.reload();
  }

  return (
    <section aria-labelledby="security-log" className="stack">
      <div className="section-head">
        <h2 id="security-log">보안 기록</h2>
        <select
          className="input small"
          aria-label="종류"
          value={group}
          onChange={(e) => {
            pages.current = 1;
            setGroup(e.target.value);
          }}
        >
          {SECURITY_GROUPS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <button type="button" className="ghost small" onClick={() => void list.reload()}>
          새로 읽기
        </button>
      </div>
      {list.error && <p className="error">{list.error}</p>}
      {!page ? (
        !list.error && <p className="label-mono loading">불러오는 중…</p>
      ) : page.events.length === 0 ? (
        <p className="rows-empty">기록 없음</p>
      ) : (
        <ul className="list">
          {page.events.map((e) => (
            <li key={e.id} className="list-cell security-event">
              <span className={securityAlert(e.kind) ? 'dot' : 'dot off'} aria-hidden="true" />
              <div className="item-main">
                <b>
                  {SECURITY_KINDS[e.kind] ?? e.kind}
                  {e.count > 1 && ` · ${e.count}번`}
                </b>
                <small>{securityDetail(e) || '–'}</small>
                {(e.ip || e.userAgent) && (
                  <small>
                    {[e.ip, e.userAgent ? browserOf(e.userAgent) : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                )}
              </div>
              <time className="label-mono" dateTime={e.at}>
                {when(e.count > 1 ? e.lastAt : e.at)}
              </time>
            </li>
          ))}
        </ul>
      )}
      {page?.next && (
        <button type="button" className="ghost small fit" onClick={more}>
          더 보기
        </button>
      )}
    </section>
  );
}
