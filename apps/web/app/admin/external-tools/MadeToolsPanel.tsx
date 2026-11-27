'use client';

import Link from 'next/link';
import { api } from '../../_lib/client-api';
import { ago } from '../../_lib/time-ago';
import { useLiveValue } from '../../_lib/use-live';
import type { SiteTool, SiteToolList } from '../../_task/types';

// 만든 도구 (2026-11-27, 사용자 "작업하면서 자동으로 mcp를 만들어내서 목록이 생겨야 하는 거 아니야?").
// 일꾼이 사이트에서 되풀이한 읽기 · 요청을 굳힌 사이트 도구(browser-tabs)를 커넥터 옆에 함께 보인다.
// 도구마다 MCP 도구를 따로 열지 않는다: 일꾼은 site_tools로 찾고 site_run으로 부른다. 켜기 · 고치기는 브라우저 메뉴에서
const BROWSER_PAGE = '/admin/p/browser-tabs';
const STATUS: Readonly<Record<string, string>> = {
  building: '만드는 중',
  reviewing: '검토 중',
  review: '켜기 대기',
  on: '켜짐',
  broken: '고장',
  off: '꺼짐',
};

/** 부른 횟수와 마지막 부르기 */
function usage(tool: SiteTool): string {
  const runs = tool.runsOk + tool.runsFailed;
  const parts = [
    tool.siteName,
    tool.mode === 'write' ? '바깥에 남김 (부를 때마다 승인)' : '읽기',
    runs > 0 ? `${runs}번 부름 · 실패 ${tool.runsFailed}` : '부른 적 없음',
    tool.lastRunAt ? `마지막 ${ago(tool.lastRunAt)}` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

export function MadeToolsPanel() {
  const tools = useLiveValue(
    'site-tools',
    () => api<SiteToolList>('GET', '/api/p/browser-tabs/integrations'),
    ['plugin.browser_tabs.*', 'task.approval.*', 'platform.plugin.changed'],
  );
  // 브라우저 플러그인이 꺼져 있으면 패키지 경로가 없다 (404)
  const off = tools.status === 404;
  const list = off ? [] : (tools.data?.integrations ?? null);
  return (
    <>
      <header className="page-head">
        <div>
          <h2>만든 도구</h2>
          <p>
            일꾼이 사이트에서 되풀이한 일을 코드로 굳힌 사이트 도구. 일꾼은 site_tools로 찾고
            site_run으로 부름 (AI 없이 서버 러너가 실행)
          </p>
        </div>
        <Link className="ghost" href={BROWSER_PAGE}>
          브라우저에서 관리
        </Link>
      </header>
      {off ? (
        <p className="rows-empty">
          브라우저 플러그인이 꺼져 있어요. 설정 › 플러그인에서 켜면 생겨요
        </p>
      ) : tools.error ? (
        <p className="error">{tools.error}</p>
      ) : list === null ? (
        <p className="label-mono loading">불러오는 중…</p>
      ) : list.length === 0 ? (
        <p className="rows-empty">
          아직 없음. 같은 사이트 일을 되풀이하면 일꾼이 도구로 굳혀 여기에 생겨요
        </p>
      ) : (
        <ul className="list" aria-label="만든 도구">
          {list.map((t) => (
            <li key={t.id} className="list-cell schedule-row connector-row">
              <div className="item-main">
                <b>
                  {t.title} <span className="pill">{STATUS[t.status] ?? t.status}</span>
                </b>
                <small>
                  {t.name} · {usage(t)}
                </small>
                {t.description && <small className="clamp">{t.description}</small>}
                {t.lastError && <small className="error">마지막 실패: {t.lastError}</small>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
