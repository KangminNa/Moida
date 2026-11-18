'use client';

import { useState } from 'react';
import { useMe } from '../../_account/live';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { flatTree, holdLabel, taskStatusLabel } from '../../_task/labels';
import {
  useAgents,
  useExternalTools,
  useRunnerChoices,
  useTasksIn,
  useUsage,
} from '../../_task/live';
import type { Agent } from '../../_task/types';
import { AgentCard } from './AgentCard';
import { type AgentBody, AgentForm } from './AgentForm';
import { AgentTeamsPanel } from './AgentTeamsPanel';
import { DeletedAgents } from './DeletedAgents';

const NEW = 'new';
const CONFLICT = '이미 바뀐 에이전트예요. 최신 내용을 다시 읽었어요';

// 에이전트: 조직도, 사용량과 한도, 추가, 편집, 중지, 재개.
export function AgentsPanel({ adding }: { adding: boolean }) {
  const agents = useAgents();
  // 맨 위(보고 대상이 없을 때)에 보일 관리자의 이름
  const ownerName = useMe().data?.name ?? '관리자';
  const running = useTasksIn('running');
  const waiting = useTasksIn('waiting');
  const usage = useUsage();
  const runners = useRunnerChoices();
  const externalTools = useExternalTools().data?.tools ?? [];
  // 열린 입력 칸: 추가, 또는 편집 중인 에이전트의 id
  const [open, setOpen] = useState<string | null>(adding ? NEW : null);
  // 팀 템플릿 칸 (에이전트가 없을 때는 늘 보인다)
  const [teams, setTeams] = useState(false);
  // 삭제한 에이전트(휴지통) 칸
  const [trash, setTrash] = useState(false);
  const action = useAction();
  const save = useAction();
  const list = agents.data?.agents;
  const problem = agents.error ?? action.problem;

  /** 실행 중이거나 기다리는 작업이 있으면 그 상태 이름 (승인 · 하위 작업 대기를 나눈다) */
  function workOf(agent: Agent): string | null {
    if (running.data?.tasks.some((t) => t.agentId === agent.id)) return taskStatusLabel('running');
    const waits = waiting.data?.tasks.find((t) => t.agentId === agent.id);
    return waits ? taskStatusLabel(waits.status, waits.waitReason) : null;
  }

  function flip(agent: Agent) {
    const paused = agent.status === 'paused';
    void action.run(
      agent.id,
      () =>
        api('POST', `/api/agents/${agent.id}/${paused ? 'resume' : 'pause'}`, {
          version: agent.version,
        }),
      {
        done: `${agent.name} ${paused ? '재개됨' : '중지됨'}`,
        reload: agents.reload,
        conflict: CONFLICT,
      },
    );
  }

  /** 휴지통으로. team이면 아래 팀 전체를, 아니면 팀원은 이 에이전트의 보고 대상에게 올린다 (서버가 같은 규칙으로) */
  function remove(agent: Agent, team: boolean) {
    const members = (list ?? []).filter((a) => a.reportsTo === agent.id).length;
    const boss = (list ?? []).find((a) => a.id === agent.reportsTo)?.name ?? ownerName;
    const what = team
      ? `${agent.name} 팀 전체(아래 팀원 모두)를 삭제할까요?`
      : members > 0
        ? `${agent.name}을(를) 삭제할까요? 아래 팀원 ${members}명은 ${boss}에게 보고하게 바뀌어요.`
        : `${agent.name}을(를) 삭제할까요?`;
    if (!window.confirm(`${what} 작업 기록은 남고 휴지통에서 복원할 수 있어요`)) return;
    void action.run(
      agent.id,
      () => api('POST', `/api/agents/${agent.id}/delete`, { version: agent.version, team }),
      { done: `${agent.name} 삭제됨`, reload: agents.reload, conflict: CONFLICT },
    );
  }

  /** 입력 칸을 열거나 닫는다. 앞 폼의 오류 문구는 남기지 않는다 */
  function show(next: string | null) {
    setOpen(next);
    save.clear();
  }

  // 저장은 패널이 돌린다 (폼은 칸만). 고치기는 본 version, 만들기는 폼이 쥔 requestId를 붙인다
  async function submit(target: Agent | null, body: AgentBody, requestId: string) {
    const reply = await save.run(
      'save',
      () =>
        target
          ? api('PATCH', `/api/agents/${target.id}`, { ...body, version: target.version })
          : api('POST', '/api/agents', { ...body, requestId }),
      {
        done: target ? '에이전트 저장됨' : '에이전트 추가됨',
        reload: agents.reload,
        conflict: '이미 바뀐 에이전트예요. 다시 저장하면 입력한 내용으로 덮어요',
      },
    );
    if (!reply?.ok) return;
    setOpen(null);
    // 한도를 바꾸면 쉬는지도 바뀐다. 이 저장에는 사용량 신호가 없다
    await usage.reload();
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>팀</h1>
          <p>
            일을 맡는 AI 에이전트. 역할 · 모델 · 권한 · 한도를 정해요. 대화는 대표가 받아 맨 위
            팀장들에게 나눠 맡겨요 (대표는 설정 › AI)
          </p>
        </div>
        {list && list.length > 0 && open !== NEW && (
          <div className="row">
            <button type="button" className="ghost" onClick={() => setTrash(!trash)}>
              휴지통
            </button>
            <button type="button" className="ghost" onClick={() => setTeams(!teams)}>
              팀 템플릿
            </button>
            <button type="button" className="cta small" onClick={() => show(NEW)}>
              ＋ 에이전트 추가
            </button>
          </div>
        )}
      </header>
      {problem && <p className="error">{problem}</p>}
      {trash && <DeletedAgents onRestored={agents.reload} onClose={() => setTrash(false)} />}
      {teams && list && list.length > 0 && (
        <AgentTeamsPanel onMade={agents.reload} onClose={() => setTeams(false)} />
      )}
      {list && list.length > 0 && <OrgChart agents={list} ownerName={ownerName} />}
      {open === NEW && (
        <AgentForm
          agent={null}
          agents={list ?? []}
          ownerName={ownerName}
          runners={runners}
          externalTools={externalTools}
          busy={save.busy !== null}
          problem={save.problem}
          onSubmit={(body, requestId) => submit(null, body, requestId)}
          onClear={save.clear}
          onClose={() => show(null)}
        />
      )}
      {list === undefined ? (
        !agents.error && <p className="label-mono">불러오는 중…</p>
      ) : list.length === 0 ? (
        open !== NEW && (
          <>
            <div className="panel">
              <b>에이전트 없음</b>
              <p className="note">
                작업은 활성 에이전트가 생길 때까지 대기. 하나씩 추가하거나 아래 팀 템플릿으로 한
                번에
              </p>
              <button type="button" className="cta small fit" onClick={() => show(NEW)}>
                에이전트 추가
              </button>
            </div>
            <AgentTeamsPanel onMade={agents.reload} onClose={null} />
          </>
        )
      ) : (
        <div className="agents">
          {list.map((a) =>
            open === a.id ? (
              <AgentForm
                key={a.id}
                agent={a}
                agents={list}
                ownerName={ownerName}
                runners={runners}
                externalTools={externalTools}
                busy={save.busy !== null}
                problem={save.problem}
                onSubmit={(body, requestId) => submit(a, body, requestId)}
                onClear={save.clear}
                onClose={() => show(null)}
              />
            ) : (
              <AgentCard
                key={a.id}
                agent={a}
                work={workOf(a)}
                hold={holdLabel(usage.data?.agents.find((u) => u.id === a.id))}
                boss={list.find((b) => b.id === a.reportsTo)?.name ?? ownerName}
                runner={
                  a.runnerId ? (runners.find((r) => r.runner.id === a.runnerId) ?? null) : undefined
                }
                busy={action.busy === a.id}
                members={list.filter((m) => m.reportsTo === a.id).length}
                onFlip={() => flip(a)}
                onEdit={() => show(a.id)}
                onRemove={(team) => remove(a, team)}
              />
            ),
          )}
        </div>
      )}
    </>
  );
}

/** 조직도: 맨 위는 관리자(정한 이름). 보고 대상이 없는 에이전트는 관리자에게 보고한다. 위임은 바로 아래 팀에게만 */
function OrgChart({ agents, ownerName }: { agents: readonly Agent[]; ownerName: string }) {
  const rows = flatTree(agents, (a) => a.reportsTo);
  return (
    <section className="panel" aria-labelledby="org-chart">
      <h2 id="org-chart">조직도</h2>
      <ol className="org" aria-label="보고 순서">
        <li>
          <b>{ownerName}</b> <small className="note">승인 · 발행</small>
        </li>
        {rows.map(({ item, depth }) => (
          <li key={item.id} style={{ paddingLeft: (depth + 1) * 20 }}>
            └ {item.name}
            {item.role && <small className="note"> · {item.role.split('\n')[0]}</small>}
            {item.status === 'paused' && <small className="note"> · 중지</small>}
          </li>
        ))}
      </ol>
    </section>
  );
}
