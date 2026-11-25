import { when } from '../../_task/labels';
import type { ExternalTool } from '../../_task/types';

/**
 * 커넥터의 상태 (2026-11-15 MCP 1단계): 제안 · 꺼짐 · 로그인 필요(OAuth, C1) · 토큰 필요 · 확인 중 · 연결 실패 · 확인 전 · 연결됨.
 * 고친 뒤 · 로그인한 뒤에 아직 확인하지 않았으면 확인 전 (서버도 그 도구를 다시 확인한다)
 */
export function connectorState(tool: ExternalTool, checking: boolean): string {
  if (tool.status === 'proposed') return '제안 · 승인 대기';
  if (tool.status === 'off') return '꺼짐';
  if (tool.catalogPending) return '도구 바뀜 · 승인 필요';
  if (tool.oauth?.needsLogin) return '로그인 필요';
  if (tool.headerName && !tool.hasSecret) return '토큰 필요';
  if (checking) return '확인 중';
  if (!tool.checkedAt || tool.checkedAt < tool.updatedAt) return '확인 전';
  return tool.checkError ? '연결 실패' : '연결됨';
}

/** OAuth 로그인에서 돌아온 까닭 (서버의 ?oauth_error=, C1). 주소의 글을 그대로 띄우지 않고 이 문구만 쓴다 */
const OAUTH_PROBLEMS: Readonly<Record<string, string>> = {
  state: '지났거나 이미 쓴 로그인이에요. 다시 로그인해 주세요',
  denied: '로그인 서버에서 취소했어요',
  token: '토큰을 받지 못했어요. 커넥터의 로그인 실패를 확인해 주세요',
  changed: '로그인하는 사이 커넥터가 바뀌었어요. 다시 로그인해 주세요',
};

/** 로그인에서 돌아온 결과의 한 줄 */
export function oauthReturn(problem: string | null, tool: ExternalTool | undefined): string {
  if (problem) return OAUTH_PROBLEMS[problem] ?? '로그인하지 못했어요';
  return `${tool?.title ?? '커넥터'} 연결했어요`;
}

/** 확인할 수 있는 커넥터: 켜져 있고 토큰이 갖춰짐 (OAuth면 로그인함) */
export function checkable(tool: ExternalTool): boolean {
  return (
    tool.status === 'active' && !(tool.headerName && !tool.hasSecret) && !tool.oauth?.needsLogin
  );
}

/** 마지막 확인 · 사용 · 오류와 확인한 도구 목록 */
export function ConnectorHealth({ tool }: { tool: ExternalTool }) {
  const seen = [
    tool.oauth?.connected && tool.oauth.expiresAt
      ? `로그인 ${when(tool.oauth.expiresAt)}까지 · 자동 갱신`
      : null,
    tool.checkedAt ? `확인 ${when(tool.checkedAt)}` : null,
    tool.lastUsedAt ? `마지막 사용 ${when(tool.lastUsedAt)}` : null,
  ].filter(Boolean);
  return (
    <>
      {seen.length > 0 && <small>{seen.join(' · ')}</small>}
      {tool.oauth?.error && (
        <small>
          <b>로그인 실패</b> {tool.oauth.error}
        </small>
      )}
      {tool.checkError && (
        <small>
          <b>확인 실패</b> {tool.checkError}
        </small>
      )}
      {tool.lastError && tool.lastFailedAt && (
        <small>
          <b>마지막 오류</b> {when(tool.lastFailedAt)} · {tool.lastError}
        </small>
      )}
      {tool.catalog.length > 0 && (
        <details className="more">
          <summary>도구 {tool.catalog.length}개</summary>
          <ul className="connector-tools">
            {tool.catalog.map((c) => (
              <li key={c.name}>
                <code>{c.name}</code>
                {c.description && <small> {c.description}</small>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/**
 * 도구가 바뀌어 멈춘 커넥터의 바뀐 점 (C3, 2026-11-25): 승인한 목록과 기다리는 새 목록을 비교한다.
 * 새 도구 · 설명이 바뀐 도구는 AI에게 다른 일을 시키는 글일 수 있어 읽고 승인한다 (서버 ToolCatalog.drift와 같은 비교)
 */
export function CatalogDrift({ tool }: { tool: ExternalTool }) {
  if (!tool.catalogPending) return null;
  const before = new Map(tool.catalog.map((c) => [c.name, c.description]));
  const names = new Set(tool.catalogPending.map((c) => c.name));
  const added = tool.catalogPending.filter((c) => !before.has(c.name));
  const changed = tool.catalogPending.filter(
    (c) => before.has(c.name) && before.get(c.name) !== c.description,
  );
  const removed = tool.catalog.filter((c) => !names.has(c.name));
  return (
    <div className="note stack" role="status">
      <b>
        도구가 바뀌어 일에 붙이지 않음
        {tool.catalogChangedAt ? ` · ${when(tool.catalogChangedAt)}` : ''}
      </b>
      <ul className="connector-tools">
        {added.map((c) => (
          <li key={`+${c.name}`}>
            새 도구 <code>{c.name}</code>
            {c.description && <small> {c.description}</small>}
          </li>
        ))}
        {changed.map((c) => (
          <li key={`~${c.name}`}>
            설명 바뀜 <code>{c.name}</code>
            <small> 전: {before.get(c.name) || '(없음)'}</small>
            <small> 후: {c.description || '(없음)'}</small>
          </li>
        ))}
        {removed.map((c) => (
          <li key={`-${c.name}`}>
            빠짐 <code>{c.name}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}
