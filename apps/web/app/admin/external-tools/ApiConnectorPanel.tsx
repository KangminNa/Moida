'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../_lib/client-api';
import { ago } from '../../_lib/time-ago';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { useApiConnectors } from '../../_task/live';
import type { ApiCallLine, ApiCallList, ApiConnector } from '../../_task/types';
import { ApiKeysForm } from './ApiKeysForm';
import { type ApiTryBody, ApiTryForm } from './ApiTryForm';

const CONFLICT = '이미 바뀐 커넥터예요. 최신 내용을 다시 읽었어요';
const EFFECT: Readonly<Record<string, string>> = {
  read: '조회',
  spend: '돈이 듦',
  write: '바깥에 남김',
};
const CALL_STATE: Readonly<Record<string, string>> = {
  held: '승인 기다림',
  running: '부르는 중',
  polling: '기다리는 중',
  fetching: '파일 받는 중',
  done: '끝남',
  failed: '실패',
  refused: '승인 안 됨',
};

/** 목록의 상태 칩 */
function stateOf(c: ApiConnector): string {
  if (c.status === 'proposed') return '승인 기다림';
  if (c.status === 'off') return '꺼짐';
  return c.keys.some((k) => !k.set) ? '키 필요' : '켜짐';
}

// API 커넥터 (2026-11-24 도구를 찾아 붙이기): 원격 MCP가 없는 서비스의 REST API를 일꾼이 쓴 정의서로 붙인 것.
// 만들기 단추는 없다: 대화에서 "○○ 붙여줘"라고 하면 일꾼이 찾아 제안하고(propose_api) 승인 카드로 켠다.
// 여기서는 키 넣기 · 하루 한도 · 켜기 · 끄기 · 시험 · 최근 부르기 · 지우기
export function ApiConnectorPanel() {
  const connectors = useApiConnectors();
  const action = useAction();
  const keys = useAction();
  const tried = useAction();
  const [open, setOpen] = useState<{ id: string; what: 'keys' | 'try' | 'calls' } | null>(null);
  const list = connectors.data?.connectors ?? null;
  const reload = connectors.reload;

  const toggle = (c: ApiConnector) => {
    const on = c.status !== 'active';
    void action.run(
      c.id,
      () => api('PATCH', `/api/api-connectors/${c.id}`, { enabled: on, version: c.version }),
      { done: `${c.title} ${on ? '켬' : '끔'}`, reload, conflict: CONFLICT },
    );
  };

  const limit = (c: ApiConnector) => {
    const raw = window.prompt(
      '돈이 드는 동작을 하루(24시간)에 몇 번까지? 넘으면 부를 때마다 승인',
      String(c.dailyMax),
    );
    if (raw === null) return;
    void action.run(
      c.id,
      () =>
        api('PATCH', `/api/api-connectors/${c.id}`, { dailyMax: Number(raw), version: c.version }),
      { done: `${c.title} 하루 한도 ${raw}번`, reload, conflict: CONFLICT },
    );
  };

  const remove = (c: ApiConnector) => {
    if (
      !window.confirm(
        `${c.title}을 지울까요? 정의서 · 키 · 부르기 기록이 함께 사라져요 (결과물은 남아요)`,
      )
    )
      return;
    void action.run(
      c.id,
      () => api('POST', `/api/api-connectors/${c.id}/delete`, { version: c.version }),
      {
        done: `${c.title} 지움`,
        reload,
        conflict: CONFLICT,
      },
    );
  };

  const saveKeys = async (c: ApiConnector, values: Record<string, string>) => {
    const reply = await keys.run(
      c.id,
      () => api('POST', `/api/api-connectors/${c.id}/keys`, { version: c.version, keys: values }),
      { done: `${c.title} 키 저장`, reload, conflict: CONFLICT },
    );
    if (reply?.ok) setOpen(null);
    return reply?.ok === true;
  };

  const tryOut = async (c: ApiConnector, body: ApiTryBody) => {
    const reply = await tried.run(
      c.id,
      () => api<ApiCallLine>('POST', `/api/api-connectors/${c.id}/try`, body),
      {
        done: (r) => `시험: ${CALL_STATE[r.status] ?? r.status}`,
        reload,
      },
    );
    if (reply?.ok) setOpen({ id: c.id, what: 'calls' });
    return reply?.ok === true;
  };

  const show = (c: ApiConnector, what: 'keys' | 'try' | 'calls') =>
    setOpen(open?.id === c.id && open.what === what ? null : { id: c.id, what });

  return (
    <>
      <header className="page-head">
        <div>
          <h2>API 커넥터</h2>
          <p>
            원격 MCP가 없는 서비스. 일꾼이 API 문서로 정의서를 내고 승인하면 모든 일꾼이 씀.
            부르기는 서버가 하고 키는 서버 밖으로 나가지 않음
          </p>
        </div>
      </header>
      {(action.problem ?? connectors.error) && (
        <p className="error">{action.problem ?? connectors.error}</p>
      )}
      {list === null ? (
        !connectors.error && <p className="label-mono">불러오는 중…</p>
      ) : list.length === 0 ? (
        <p className="rows-empty">
          API 커넥터 없음. 대화에서 "○○ 붙여줘"라고 하면 일꾼이 찾아 제안해요
        </p>
      ) : (
        <ul className="list" aria-label="API 커넥터">
          {list.map((c) => (
            <li key={c.id} className="list-cell schedule-row connector-row">
              <div className="item-main">
                <b>
                  {c.title} <span className="pill">{stateOf(c)}</span>
                </b>
                <small>
                  {c.name} · {c.base} · 오늘 {c.spentToday}/{c.dailyMax}번
                  {c.source.kind ? ` · 찾은 곳 ${c.source.kind}` : ''}
                  {c.lastUsedAt ? ` · 마지막 ${ago(c.lastUsedAt)}` : ''}
                </small>
                <small>
                  {c.operations
                    .map((o) => `${o.title}(${EFFECT[o.effect] ?? o.effect})`)
                    .join(' · ')}
                </small>
                {c.pending && (
                  <small>승인 기다리는 새 버전: 동작 {c.pending.operations.length}개</small>
                )}
                {c.lastError && <small className="error">마지막 실패: {c.lastError}</small>}
                {c.note && <small className="clamp">제안한 까닭: {c.note}</small>}
                {c.status === 'proposed' && (
                  <small>
                    승인을 기다려요: <Link href="/admin/approvals">승인</Link>에서 정하면 켜지고 그
                    뒤 키를 넣어요
                  </small>
                )}
                {open?.id === c.id && open.what === 'keys' && (
                  <ApiKeysForm
                    connector={c}
                    busy={keys.busy !== null}
                    problem={keys.problem}
                    onSubmit={(v) => saveKeys(c, v)}
                    onEdit={keys.clear}
                  />
                )}
                {open?.id === c.id && open.what === 'try' && (
                  <ApiTryForm
                    connector={c}
                    busy={tried.busy !== null}
                    problem={tried.problem}
                    onSubmit={(b) => tryOut(c, b)}
                    onEdit={tried.clear}
                  />
                )}
                {open?.id === c.id && open.what === 'calls' && <RecentCalls connector={c} />}
              </div>
              {c.status !== 'proposed' && (
                <div className="row">
                  {c.keys.length > 0 && (
                    <button
                      type="button"
                      className={c.keys.some((k) => !k.set) ? 'cta small' : 'ghost'}
                      onClick={() => show(c, 'keys')}
                    >
                      키 넣기
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => show(c, 'try')}
                    disabled={c.status !== 'active'}
                  >
                    시험
                  </button>
                  <button type="button" className="ghost" onClick={() => show(c, 'calls')}>
                    최근 부르기
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={action.busy === c.id}
                    onClick={() => limit(c)}
                  >
                    하루 한도
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={action.busy === c.id}
                    onClick={() => toggle(c)}
                  >
                    {c.status === 'active' ? '끄기' : '켜기'}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={action.busy === c.id}
                    onClick={() => remove(c)}
                  >
                    지우기
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** 커넥터의 최근 부르기 20개 (일꾼의 부르기 · 관리자의 시험) */
function RecentCalls({ connector }: { connector: ApiConnector }) {
  const calls = useLiveValue(
    `api-calls-${connector.id}`,
    () => api<ApiCallList>('GET', `/api/api-connectors/${connector.id}/calls`),
    ['task.api_call.*', 'task.approval.*'],
  );
  if (calls.error) return <p className="error">{calls.error}</p>;
  const list = calls.data?.calls ?? null;
  if (list === null) return <p className="label-mono">불러오는 중…</p>;
  if (list.length === 0) return <p className="rows-empty">부른 적 없음</p>;
  return (
    <ul className="list" aria-label={`${connector.title} 최근 부르기`}>
      {list.map((r) => (
        <li key={r.id} className="list-cell">
          <small>
            {ago(r.createdAt)} · {r.operation} · {CALL_STATE[r.status] ?? r.status}
            {r.tried ? ' · 관리자 시험' : ''}
            {r.outputIds.length > 0 ? ` · 파일 ${r.outputIds.length}개 (결과물)` : ''}
          </small>
          {r.error && <p className="error">{r.error}</p>}
          {r.answer !== null && <code className="mono clamp">{oneLine(r.answer)}</code>}
        </li>
      ))}
    </ul>
  );
}

/** 답을 한 줄로 (200자) */
function oneLine(answer: unknown): string {
  const text = JSON.stringify(answer);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
