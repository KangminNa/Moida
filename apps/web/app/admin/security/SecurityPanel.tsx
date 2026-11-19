'use client';

import Link from 'next/link';
import { useDevices, useSpace } from '../../_account/live';
import type { WebSessionItem, WebSessionList } from '../../_account/types';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { browserOf } from '../../_platform/labels';
import { when } from '../../_task/labels';

/** 보안 기록을 지우기 전에 두는 날수 (서버의 SecurityLog.KEEP_DAYS와 같다) */
const KEEP_DAYS = 90;

// 보안 설정 값 · 로그인한 곳 · 기기의 마지막 접근. 로그인 끝내기는 여기서, 기기 끊기는 연결된 기기 화면에서.
export function SecurityPanel() {
  const sessions = useLiveValue(
    'auth-sessions',
    () => api<WebSessionList>('GET', '/api/auth/sessions'),
    [],
  );
  const devices = useDevices();
  const space = useSpace();
  const action = useAction();
  const list = sessions.data;
  const problem = sessions.error ?? action.problem;
  const live = (devices.data?.devices ?? [])
    .filter((d) => d.revokedAt === null)
    .sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''));

  const end = (s: WebSessionItem) =>
    action.run(s.id, () => api('POST', `/api/auth/sessions/${s.id}/end`), {
      done: '로그아웃시켰어요',
      reload: sessions.reload,
    });

  function endOthers() {
    if (!window.confirm('이 브라우저 말고 모든 곳에서 로그아웃할까요?')) return;
    void action.run('others', () => api('POST', '/api/auth/sessions/end-others'), {
      done: '다른 곳 모두 로그아웃했어요',
      reload: sessions.reload,
    });
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>보안</h1>
          <p>로그인한 곳과 기기의 마지막 접근, 로그인 시도 · 거부된 접근 기록</p>
        </div>
      </header>
      {problem && <p className="error">{problem}</p>}
      {list && (
        <section className="panel" aria-labelledby="security-settings">
          <h2 id="security-settings">보안 설정</h2>
          <ul className="facts">
            <li>
              <span>로그인 유지</span>
              <b>마지막으로 쓴 날부터 {list.limits.sessionDays}일</b>
            </li>
            <li>
              <span>틀린 로그인</span>
              <b>
                아이디마다 {list.limits.triesPerLogin}번 · 한 곳에서 {list.limits.triesPerPlace}번 /{' '}
                {list.limits.windowSeconds}초, 넘으면 잠시 막음
              </b>
            </li>
            <li>
              <span>앱 연결 허용</span>
              <b>
                {space.data?.hostedApps ? '켜짐' : '꺼짐'} · <Link href="/admin/site">사이트</Link>
              </b>
            </li>
            <li>
              <span>외부 로그인</span>
              <b>
                <Link href="/admin/account">계정</Link>에서 연결 · 끊기
              </b>
            </li>
            <li>
              <span>보안 기록 보관</span>
              <b>{KEEP_DAYS}일</b>
            </li>
          </ul>
        </section>
      )}
      <section aria-labelledby="security-sessions" className="stack">
        <div className="section-head">
          <h2 id="security-sessions">로그인한 곳</h2>
          {list && list.sessions.length > 1 && (
            <button
              type="button"
              className="ghost small"
              disabled={action.busy !== null}
              onClick={endOthers}
            >
              다른 곳 모두 로그아웃
            </button>
          )}
        </div>
        {!list ? (
          !sessions.error && <p className="label-mono">불러오는 중…</p>
        ) : (
          <ul className="list">
            {list.sessions.map((s) => (
              <li key={s.id} className="item">
                <div className="item-main">
                  <b>
                    {browserOf(s.userAgent)}
                    {s.current && <span className="pill strong">이 브라우저</span>}
                  </b>
                  <small>
                    {s.lastIp ?? s.ip ?? '주소 모름'} · 로그인 {when(s.createdAt)} · 마지막 접근{' '}
                    {s.lastSeenAt ? when(s.lastSeenAt) : '–'}
                  </small>
                </div>
                {!s.current && (
                  <button
                    type="button"
                    className="ghost small"
                    disabled={action.busy !== null}
                    onClick={() => end(s)}
                  >
                    {action.busy === s.id ? '로그아웃 중' : '로그아웃'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="security-devices" className="stack">
        <div className="section-head">
          <h2 id="security-devices">기기 마지막 접근</h2>
          <Link className="text-button" href="/admin/devices">
            연결된 기기
          </Link>
        </div>
        {live.length === 0 ? (
          <p className="rows-empty">연결된 기기 없음</p>
        ) : (
          <ul className="list">
            {live.map((d) => (
              <li key={d.id} className="item">
                <div className="item-main">
                  <b>{d.name}</b>
                  <small>
                    {d.lastSeenAt
                      ? [when(d.lastSeenAt), d.lastIp].filter(Boolean).join(' · ')
                      : '접근 기록 없음'}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
