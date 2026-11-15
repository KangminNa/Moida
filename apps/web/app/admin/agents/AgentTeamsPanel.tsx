'use client';

import { useId, useRef, useState } from 'react';
import { api } from '../../_lib/client-api';
import { SCOPE_LABELS } from '../../_lib/types';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { NEEDS_LABELS } from '../../_task/labels';
import { useEngines } from '../../_task/live';
import type { AgentTeam, AgentTeamList, AgentTeamSaved } from '../../_task/types';

// 팀 템플릿: 역할 · 권한 · 조직도가 정해진 팀을 버튼 한 번에 만든다 (서버가 한 번에, 반쪽 팀이 남지 않게).
// 템플릿은 서버 코드에 있어 바뀌지 않는다: 처음 한 번만 읽는다.
export function AgentTeamsPanel({
  onMade,
  onClose,
}: {
  /** 팀을 만든 뒤 (에이전트 목록 다시 읽기) */
  onMade: () => void;
  /** 닫기 버튼. 없으면 닫지 않는 자리 (에이전트가 하나도 없을 때) */
  onClose: (() => void) | null;
}) {
  const id = useId();
  const teams = useLiveValue(
    'agent-teams',
    () => api<AgentTeamList>('GET', '/api/agent-teams'),
    [],
  );
  const make = useAction();
  // 고르기 전에는 엔진 목록의 첫 줄(기본)
  const engines = useEngines();
  const [picked, setTool] = useState<string | null>(null);
  const tool = picked ?? engines[0]?.name ?? '';
  // 템플릿마다 requestId 하나: 응답을 놓쳐 다시 눌러도 팀은 하나. 만든 뒤에는 새로
  const requestIds = useRef(new Map<string, string>());

  async function create(team: AgentTeam) {
    const requestId = requestIds.current.get(team.key) ?? crypto.randomUUID();
    requestIds.current.set(team.key, requestId);
    const reply = await make.run(
      team.key,
      () => api<AgentTeamSaved>('POST', '/api/agent-teams', { requestId, team: team.key, tool }),
      { done: (saved) => `${team.title} 만들어짐 (${saved.agents.length}명)`, reload: onMade },
    );
    if (reply?.ok) requestIds.current.delete(team.key);
  }

  return (
    <section className="panel" aria-labelledby={`${id}-title`}>
      <div className="page-head">
        <h2 id={`${id}-title`}>팀 템플릿</h2>
        {onClose && (
          <button type="button" className="ghost" onClick={onClose}>
            닫기
          </button>
        )}
      </div>
      <p className="note">
        역할 · 권한 · 보고 대상이 정해진 팀을 한 번에 추가. 만든 뒤 에이전트마다 편집할 수 있어요
      </p>
      <div className="field">
        <label htmlFor={`${id}-tool`}>AI 도구</label>
        <select
          id={`${id}-tool`}
          className="input"
          value={tool}
          onChange={(e) => setTool(e.target.value)}
        >
          {engines.map((e) => (
            <option key={e.name} value={e.name}>
              {e.label}
            </option>
          ))}
        </select>
      </div>
      {(teams.error ?? make.problem) && <p className="error">{teams.error ?? make.problem}</p>}
      {teams.data === null ? (
        !teams.error && <p className="label-mono">불러오는 중…</p>
      ) : (
        <ul className="team-templates" aria-label="팀 템플릿 목록">
          {teams.data.teams.map((team) => (
            <li key={team.key} className="panel">
              <TeamCard team={team} busy={make.busy !== null} onCreate={() => void create(team)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 템플릿 하나: 설명, 필요한 것, 구성원(보고 대상 아래로 들여 씀), 만들기 */
function TeamCard({
  team,
  busy,
  onCreate,
}: {
  team: AgentTeam;
  busy: boolean;
  onCreate: () => void;
}) {
  return (
    <article className="stack" aria-label={team.title}>
      <div>
        <b>{team.title}</b>
        <p className="note">{team.description}</p>
      </div>
      {team.needs.length > 0 && (
        <div className="row">
          {team.needs.map((need) => (
            <span key={need} className="pill">
              {NEEDS_LABELS[need] ?? need}
            </span>
          ))}
        </div>
      )}
      <ul className="org" aria-label={`${team.title} 구성원`}>
        {team.members.map((m) => (
          <li key={m.key} style={{ paddingLeft: m.reportsTo ? 20 : 0 }}>
            {m.reportsTo ? '└ ' : ''}
            <b>{m.name}</b>
            <small className="note">
              {' '}
              · {m.scopes.map((s) => SCOPE_LABELS[s] ?? s).join(' · ')} ·{' '}
              {m.role.split('\n')[1]?.replace(/^- /, '') ?? m.role.split('\n')[0]}
            </small>
          </li>
        ))}
      </ul>
      <div className="row">
        <button type="button" className="cta small" disabled={busy} onClick={onCreate}>
          이 팀 만들기
        </button>
      </div>
    </article>
  );
}
