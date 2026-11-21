'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { holdLabel, taskStatusLabel } from '../../_task/labels';
import {
  useAgents,
  useExternalTools,
  useLead,
  useRunnerChoices,
  useTasksIn,
  useUsage,
} from '../../_task/live';
import type { Agent, Chat } from '../../_task/types';
import { AgentCard, LeadCard } from './AgentCard';
import { type AgentBody, AgentForm } from './AgentForm';
import { DeletedAgents } from './DeletedAgents';

const NEW = 'new';
const CONFLICT = '이미 바뀐 에이전트예요. 최신 내용을 다시 읽었어요';
/** 역할 다듬기 (2026-11-20 ECC형 에이전트 정의): 대표에게 보내는 말. 표준 형식은 대표의 지시문 틀에 있다 */
const TIDY_ROLES =
  '일꾼들의 역할 설명을 표준 형식으로 다듬어 제안해 줘. 일을 많이 하는 일꾼부터 3명까지, 내가 쓴 뜻은 바꾸지 말고 빠진 단락만 채워 줘.';

// 에이전트 (2026-11-21 팀 없는 에이전트): 맨 앞에 대표, 그 뒤로 모두 같은 일꾼. 사용량과 한도, 추가, 편집, 중지, 재개.
// 대표는 목록(api/agents)에 없어 따로 읽고(useLead), 고치기는 설정 › AI에서 한다.
export function AgentsPanel({ adding }: { adding: boolean }) {
  const agents = useAgents();
  const lead = useLead().data?.lead ?? null;
  const running = useTasksIn('running');
  const waiting = useTasksIn('waiting');
  const usage = useUsage();
  const runners = useRunnerChoices();
  const externalTools = useExternalTools().data?.tools ?? [];
  // 열린 입력 칸: 추가, 또는 편집 중인 에이전트의 id
  const [open, setOpen] = useState<string | null>(adding ? NEW : null);
  // 삭제한 에이전트(휴지통) 칸
  const [trash, setTrash] = useState(false);
  const action = useAction();
  const save = useAction();
  const tidy = useAction();
  const router = useRouter();
  const list = agents.data?.agents;
  const problem = agents.error ?? action.problem ?? tidy.problem;

  /** 실행 중이거나 기다리는 작업이 있으면 그 상태 이름 (승인 · 하위 작업 대기를 나눈다) */
  function workOf(agent: Agent): string | null {
    if (running.data?.tasks.some((t) => t.agentId === agent.id)) return taskStatusLabel('running');
    const waits = waiting.data?.tasks.find((t) => t.agentId === agent.id);
    return waits ? taskStatusLabel(waits.status, waits.waitReason) : null;
  }

  /** 쉬기 한도에 닿았으면 그 문구 */
  function hold(agent: Agent): string | null {
    return holdLabel(usage.data?.agents.find((u) => u.id === agent.id));
  }

  /** 대표와 새 대화를 열어 역할 다듬기를 맡기고 그 대화로 간다 (제안은 결과 카드의 승인으로) */
  async function tidyRoles() {
    const reply = await tidy.run('tidy', () =>
      api<Chat>('POST', '/api/chats', { requestId: crypto.randomUUID(), message: TIDY_ROLES }),
    );
    if (reply?.ok) router.push(`/admin/chats/${reply.data.id}`);
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

  /** 휴지통으로. 작업 기록은 남고 복원하면 다시 일을 받는다 */
  function remove(agent: Agent) {
    if (
      !window.confirm(
        `${agent.name}을(를) 삭제할까요? 작업 기록은 남고 휴지통에서 복원할 수 있어요`,
      )
    )
      return;
    void action.run(
      agent.id,
      () => api('POST', `/api/agents/${agent.id}/delete`, { version: agent.version }),
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
          <h1>에이전트</h1>
          <p>대화는 대표가 받아 일꾼에게 나눠 맡겨요. 모든 일꾼은 같은 권한으로 같은 일을 해요</p>
        </div>
        {list && list.length > 0 && open !== NEW && (
          <div className="row">
            <button type="button" className="ghost" onClick={() => setTrash(!trash)}>
              휴지통
            </button>
            <button
              type="button"
              className="ghost"
              disabled={tidy.busy !== null}
              title="대표가 역할 설명을 표준 형식(언제 맡기나 · 하는 일 · 순서 · 결과 형식 · 확인 · 하지 않는 것)으로 다듬어 승인으로 올려요"
              onClick={tidyRoles}
            >
              역할 다듬기
            </button>
            <button type="button" className="cta small" onClick={() => show(NEW)}>
              ＋ 에이전트 추가
            </button>
          </div>
        )}
      </header>
      {problem && <p className="error">{problem}</p>}
      {trash && <DeletedAgents onRestored={agents.reload} onClose={() => setTrash(false)} />}
      {open === NEW && (
        <AgentForm
          agent={null}
          agents={list ?? []}
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
            {lead && <LeadCard lead={lead} work={workOf(lead)} hold={hold(lead)} />}
            <div className="panel">
              <b>일꾼 없음</b>
              <p className="note">대표가 맡길 일꾼이 생길 때까지 작업은 대기</p>
              <button type="button" className="cta small fit" onClick={() => show(NEW)}>
                에이전트 추가
              </button>
            </div>
          </>
        )
      ) : (
        <div className="agents">
          {lead && <LeadCard lead={lead} work={workOf(lead)} hold={hold(lead)} />}
          {list.map((a) =>
            open === a.id ? (
              <AgentForm
                key={a.id}
                agent={a}
                agents={list}
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
                hold={hold(a)}
                score={usage.data?.agents.find((u) => u.id === a.id)?.scorecard ?? null}
                runner={
                  a.runnerId ? (runners.find((r) => r.runner.id === a.runnerId) ?? null) : undefined
                }
                busy={action.busy === a.id}
                onFlip={() => flip(a)}
                onEdit={() => show(a.id)}
                onRemove={() => remove(a)}
              />
            ),
          )}
        </div>
      )}
    </>
  );
}
