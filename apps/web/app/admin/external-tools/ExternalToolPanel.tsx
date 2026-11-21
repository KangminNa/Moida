'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useExternalTools } from '../../_task/live';
import type { ExternalTool, ExternalToolOAuthStart } from '../../_task/types';
import { ConnectorHealth, checkable, connectorState, oauthReturn } from './ConnectorHealth';
import { type ExternalToolBody, ExternalToolForm } from './ExternalToolForm';

const NEW = 'new';
const SCREEN = '/admin/external-tools';
const CONFLICT = '이미 바뀐 도구예요. 최신 내용을 다시 읽었어요';

// 외부 도구 (2차 7단계): 바깥 서비스의 원격 MCP 서버. 에이전트 편집에서 허락하면 러너가 그 에이전트의 일에만 붙인다.
// AI가 제안한 도구는 승인(결과 카드)로 정한다. 토큰은 넣기만 하고 다시 보이지 않는다.
// 연결 확인(2026-11-15 MCP 1단계)은 러너가 하고(도구 목록 · 실패 까닭), 에이전트의 일에서 부른 때 · 오류가 함께 보인다.
// OAuth 로그인(C1): "로그인"이 로그인 서버의 주소를 받아 같은 탭으로 간다. 돌아오면 결과를 한 번 보이고 주소에서 지운다.
export function ExternalToolPanel({
  connected,
  oauthProblem,
}: {
  /** 로그인에서 돌아온 커넥터 id (?connected=) */
  connected: string | null;
  /** 로그인에서 돌아온 실패 까닭 (?oauth_error=) */
  oauthProblem: string | null;
}) {
  const router = useRouter();
  const tools = useExternalTools();
  const action = useAction();
  const save = useAction();
  const token = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [secretFor, setSecretFor] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  /** 연결 확인을 맡긴 도구 → 그때의 checkedAt (결과가 오면 값이 달라져 "확인 중"이 풀린다) */
  const [checking, setChecking] = useState<Readonly<Record<string, string | null>>>({});
  /** 돌아온 결과: 주소에서 지운 뒤에도 남게 처음 값만 쥔다 */
  const [returned] = useState(() =>
    connected || oauthProblem ? { connected, oauthProblem } : null,
  );
  const list = tools.data?.tools ?? null;
  const problem = action.problem ?? tools.error;

  // 새로 고침 · 뒤로 가기에 같은 결과가 다시 뜨지 않게 주소의 쿼리를 바꿔치기로 지운다
  useEffect(() => {
    if (connected || oauthProblem) router.replace(SCREEN, { scroll: false });
  }, [connected, oauthProblem, router]);

  function close() {
    setOpen(null);
    save.clear();
  }

  async function submit(target: ExternalTool | null, body: ExternalToolBody, requestId: string) {
    const reply = await save.run(
      'save',
      () =>
        target
          ? api('PATCH', `/api/external-tools/${target.id}`, { ...body, version: target.version })
          : api('POST', '/api/external-tools', { ...body, requestId }),
      { done: `${body.title} 저장됨`, reload: tools.reload, conflict: CONFLICT },
    );
    if (reply?.ok) setOpen(null);
    return reply?.ok === true;
  }

  function toggle(tool: ExternalTool) {
    const on = tool.status !== 'active';
    void action.run(
      tool.id,
      () => api('PATCH', `/api/external-tools/${tool.id}`, { enabled: on, version: tool.version }),
      { done: `${tool.title} ${on ? '켬' : '끔'}`, reload: tools.reload, conflict: CONFLICT },
    );
  }

  async function check(tool: ExternalTool) {
    const reply = await action.run(
      tool.id,
      () => api('POST', `/api/external-tools/${tool.id}/check`, {}),
      { done: `${tool.title} 연결 확인 맡김`, reload: tools.reload },
    );
    if (reply?.ok) setChecking((c) => ({ ...c, [tool.id]: tool.checkedAt }));
  }

  /** OAuth 로그인: 서버가 로그인 서버를 찾아(처음이면 등록) 준 주소로 같은 탭에서 간다. 돌아오면 이 화면으로 */
  async function login(tool: ExternalTool) {
    const reply = await action.run(
      tool.id,
      () =>
        api<ExternalToolOAuthStart>('POST', `/api/external-tools/${tool.id}/oauth/start`, {
          version: tool.version,
        }),
      { reload: tools.reload, conflict: CONFLICT },
    );
    if (reply?.ok) window.location.assign(reply.data.url);
  }

  function remove(tool: ExternalTool) {
    const who =
      tool.agents.length > 0 ? ` 허락한 에이전트 ${tool.agents.length}명에게서도 빠져요.` : '';
    if (!window.confirm(`${tool.title} 도구를 지울까요?${who}`)) return;
    void action.run(
      tool.id,
      () => api('POST', `/api/external-tools/${tool.id}/delete`, { version: tool.version }),
      { done: `${tool.title} 삭제`, reload: tools.reload, conflict: CONFLICT },
    );
  }

  async function putSecret(event: FormEvent, tool: ExternalTool) {
    event.preventDefault();
    const reply = await token.run(
      tool.id,
      () => api('POST', `/api/external-tools/${tool.id}/secret`, { secret, version: tool.version }),
      { done: `${tool.title} 토큰 저장`, reload: tools.reload, conflict: CONFLICT },
    );
    if (!reply?.ok) return;
    setSecret('');
    setSecretFor(null);
  }

  const form = (tool: ExternalTool | null) => (
    <ExternalToolForm
      key={tool?.version ?? NEW}
      tool={tool}
      busy={save.busy !== null}
      problem={save.problem}
      onSubmit={(body, requestId) => submit(tool, body, requestId)}
      onEdit={save.clear}
      onClose={close}
    />
  );

  return (
    <>
      <header className="page-head">
        <div>
          <h1>커넥터</h1>
          <p>바깥 서비스의 MCP. 팀 화면에서 허락한 에이전트의 일에만 붙고, 일할 때 먼저 씀</p>
        </div>
        {open !== NEW && (
          <button type="button" className="cta small" onClick={() => setOpen(NEW)}>
            커넥터 추가
          </button>
        )}
      </header>
      {returned && (
        <p className={returned.oauthProblem ? 'error' : 'note'} role="status">
          {oauthReturn(
            returned.oauthProblem,
            list?.find((t) => t.id === returned.connected),
          )}
        </p>
      )}
      {problem && <p className="error">{problem}</p>}
      {open === NEW && form(null)}
      {list === null ? (
        !problem && <p className="label-mono">불러오는 중…</p>
      ) : list.length === 0 ? (
        <p className="rows-empty">커넥터 없음</p>
      ) : (
        <ul className="list" aria-label="커넥터">
          {list.map((t) =>
            open === t.id ? (
              <li key={t.id} className="list-cell">
                {form(t)}
              </li>
            ) : (
              <li key={t.id} className="list-cell schedule-row connector-row">
                <div className="item-main">
                  <b>
                    {t.title}{' '}
                    <span className="pill">
                      {connectorState(t, checking[t.id] === t.checkedAt)}
                    </span>
                  </b>
                  <small>
                    x-{t.name} · {t.url}
                    {t.headerName ? ` · 토큰 ${t.hasSecret ? '있음' : '없음'}` : ''}
                    {t.oauth
                      ? ` · OAuth${t.oauth.issuer ? ` ${new URL(t.oauth.issuer).host}` : ''}`
                      : ''}{' '}
                    · 허락: {t.agents.map((a) => a.name).join(', ') || '없음'}
                  </small>
                  {t.note && <small className="clamp">제안한 까닭: {t.note}</small>}
                  <ConnectorHealth tool={t} />
                  {secretFor === t.id && (
                    <form className="row" onSubmit={(e) => putSecret(e, t)}>
                      <input
                        className="input"
                        type="password"
                        autoComplete="off"
                        aria-label={`${t.title} 토큰`}
                        value={secret}
                        required
                        maxLength={4000}
                        placeholder={`${t.headerName}에 실을 값`}
                        onChange={(e) => {
                          token.clear();
                          setSecret(e.target.value);
                        }}
                      />
                      <button type="submit" className="cta small" disabled={token.busy !== null}>
                        저장
                      </button>
                    </form>
                  )}
                  {secretFor === t.id && token.problem && <p className="error">{token.problem}</p>}
                </div>
                <div className="row">
                  {checkable(t) && (
                    <button
                      type="button"
                      className="ghost"
                      disabled={action.busy === t.id}
                      onClick={() => void check(t)}
                    >
                      연결 확인
                    </button>
                  )}
                  {t.oauth && t.status !== 'proposed' && (
                    <button
                      type="button"
                      className={t.oauth.needsLogin ? 'cta small' : 'ghost'}
                      disabled={action.busy === t.id}
                      onClick={() => void login(t)}
                    >
                      {t.oauth.needsLogin ? '로그인' : '다시 로그인'}
                    </button>
                  )}
                  {t.headerName && t.status !== 'proposed' && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setSecretFor(secretFor === t.id ? null : t.id)}
                    >
                      토큰 넣기
                    </button>
                  )}
                  {t.status !== 'proposed' && (
                    <button
                      type="button"
                      className="ghost"
                      disabled={action.busy === t.id}
                      onClick={() => toggle(t)}
                    >
                      {t.status === 'active' ? '끄기' : '켜기'}
                    </button>
                  )}
                  <button type="button" className="ghost" onClick={() => setOpen(t.id)}>
                    편집
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={action.busy === t.id}
                    onClick={() => remove(t)}
                  >
                    삭제
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </>
  );
}
