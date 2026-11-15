import { when } from '../../_task/labels';
import type { ExternalTool } from '../../_task/types';

/**
 * 커넥터의 상태 (2026-11-15 MCP 1단계): 제안 · 꺼짐 · 토큰 필요 · 확인 중 · 연결 실패 · 확인 전 · 연결됨.
 * 고친 뒤에 아직 확인하지 않았으면 확인 전 (서버도 그 도구를 다시 확인한다)
 */
export function connectorState(tool: ExternalTool, checking: boolean): string {
  if (tool.status === 'proposed') return '제안 · 승인 대기';
  if (tool.status === 'off') return '꺼짐';
  if (tool.headerName && !tool.hasSecret) return '토큰 필요';
  if (checking) return '확인 중';
  if (!tool.checkedAt || tool.checkedAt < tool.updatedAt) return '확인 전';
  return tool.checkError ? '연결 실패' : '연결됨';
}

/** 확인할 수 있는 커넥터: 켜져 있고 토큰이 갖춰짐 */
export function checkable(tool: ExternalTool): boolean {
  return tool.status === 'active' && !(tool.headerName && !tool.hasSecret);
}

/** 마지막 확인 · 사용 · 오류와 확인한 도구 목록 */
export function ConnectorHealth({ tool }: { tool: ExternalTool }) {
  const seen = [
    tool.checkedAt ? `확인 ${when(tool.checkedAt)}` : null,
    tool.lastUsedAt ? `마지막 사용 ${when(tool.lastUsedAt)}` : null,
  ].filter(Boolean);
  return (
    <>
      {seen.length > 0 && <small>{seen.join(' · ')}</small>}
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
