'use client';

import { type FormEvent, useId, useRef, useState } from 'react';
import { type RunnerChoice, useEngines } from '../../_task/live';
import type { Agent, ExternalTool } from '../../_task/types';
import { type Access, AccessFields } from './AccessFields';
import { BossField } from './BossField';
import { LimitField } from './LimitField';
import { ReviewerField } from './ReviewerField';
import { RunnerField } from './RunnerField';
import { type Runtime, RuntimeFields, runtimeFor } from './RuntimeFields';

/** 빈 칸은 한도 없음. 맞지 않는 값이면 undefined */
function limitOf(text: string): number | null | undefined {
  const value = text.trim();
  if (value === '') return null;
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit >= 1 ? limit : undefined;
}

/** 빈 칸은 쓰지 않음. 맞지 않는 값이면 undefined */
function percentOf(text: string): number | null | undefined {
  const value = text.trim();
  if (value === '') return null;
  const percent = Number(value);
  return Number.isInteger(percent) && percent >= 1 && percent <= 100 ? percent : undefined;
}

/** 저장할 때 보내는 본문 (POST · PATCH /api/agents). 만들기의 requestId와 고치기의 version은 패널이 붙인다 */
export type AgentBody = {
  name: string;
  role: string;
  tool: string;
  scopes: readonly string[];
  approvalActions: readonly string[];
  monthlyLimit: number | null;
  fiveHourLimit: number | null;
  planStopPercent: number | null;
  reportsTo: string | null;
  runnerId: string | null;
  /** 허락한 외부 도구의 이름 (2차 7단계) */
  externalTools: readonly string[];
  /** 모델 · 생각 강도 (빈 글이면 CLI의 기본, 2차 7단계) */
  model: string;
  effort: string;
  /** 검토자 짝 (편집에서만, 만들기는 서버가 보지 않는다) */
  reviewerId?: string | null;
};

// 에이전트 추가·편집 폼: 칸의 상태와 보낼 본문만 가진다. 저장은 패널이 돌린다 (onSubmit). agent가 있으면 편집이다.
export function AgentForm({
  agent,
  agents,
  ownerName,
  runners,
  externalTools,
  busy,
  problem,
  onSubmit,
  onClear,
  onClose,
}: {
  agent: Agent | null;
  /** 공간의 모든 에이전트 (보고 대상 고르기) */
  agents: readonly Agent[];
  /** 관리자의 이름 (보고 대상이 없으면 이 사람에게) */
  ownerName: string;
  /** 묶을 수 있는 러너 (실행 러너 고르기) */
  runners: readonly RunnerChoice[];
  /** 공간의 외부 도구 (허락 칸, 2차 7단계) */
  externalTools: readonly ExternalTool[];
  busy: boolean;
  problem: string | null;
  onSubmit: (body: AgentBody, requestId: string) => void;
  /** 다시 저장한다: 앞의 오류 문구를 지운다 */
  onClear: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(agent?.name ?? '');
  const [role, setRole] = useState(agent?.role ?? '');
  // 칸의 값은 고른 글자 그대로 둔다 (값 목록은 서버가 본다). 고르기 전에는 엔진 목록의 첫 줄(기본)
  const engines = useEngines();
  const [picked, setTool] = useState<string | null>(agent?.tool ?? null);
  const tool = picked ?? engines[0]?.name ?? '';
  const [runtime, setRuntime] = useState<Runtime>({
    model: agent?.model ?? '',
    effort: agent?.effort ?? '',
  });
  const [reportsTo, setReportsTo] = useState(agent?.reportsTo ?? '');
  const [runnerId, setRunnerId] = useState(agent?.runnerId ?? '');
  const [reviewerId, setReviewerId] = useState(agent?.reviewerId ?? '');
  const [access, setAccess] = useState<Access>({
    scopes: agent?.scopes ?? [],
    actions: agent?.approvalActions ?? [],
    tools: agent?.externalTools ?? [],
  });
  const { scopes } = access;
  const sandboxed = scopes.includes('code') || scopes.includes('make');
  const [limit, setLimit] = useState(agent?.monthlyLimit?.toString() ?? '');
  const [fiveHour, setFiveHour] = useState(agent?.fiveHourLimit?.toString() ?? '');
  const [planStop, setPlanStop] = useState(agent?.planStopPercent?.toString() ?? '');
  const [problems, setProblems] = useState<{
    limit?: string;
    fiveHour?: string;
    planStop?: string;
  }>({});
  // 같은 내용을 다시 보내면 같은 requestId: 응답을 놓쳐 다시 눌러도 에이전트는 하나다
  const requestId = useRef<string | null>(null);

  function change(apply: () => void) {
    requestId.current = null;
    apply();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const monthlyLimit = limitOf(limit);
    const fiveHourLimit = limitOf(fiveHour);
    const planStopPercent = percentOf(planStop);
    const found = {
      ...(monthlyLimit === undefined ? { limit: '1 이상의 정수를 입력해 주세요' } : {}),
      ...(fiveHourLimit === undefined ? { fiveHour: '1 이상의 정수를 입력해 주세요' } : {}),
      ...(planStopPercent === undefined ? { planStop: '1~100 사이의 정수를 입력해 주세요' } : {}),
    };
    setProblems(found);
    onClear();
    if (monthlyLimit === undefined || fiveHourLimit === undefined || planStopPercent === undefined)
      return;
    requestId.current ??= crypto.randomUUID();
    onSubmit(
      {
        name: name.trim(),
        role: role.trim(),
        tool,
        scopes,
        approvalActions: access.actions,
        externalTools: access.tools,
        monthlyLimit,
        fiveHourLimit,
        planStopPercent,
        reportsTo: reportsTo || null,
        // 코드 · 만들기는 코드 러너 칸에서만 돌아 묶지 않는다 (서버도 막는다)
        runnerId: sandboxed ? null : runnerId || null,
        model: runtime.model.trim(),
        effort: runtime.effort,
        ...(agent ? { reviewerId: reviewerId || null } : {}),
      },
      requestId.current,
    );
  }

  return (
    <form
      className="panel"
      onSubmit={submit}
      aria-label={agent ? `${agent.name} 편집` : '에이전트 추가'}
    >
      <div className="field">
        <label htmlFor={`${id}-name`}>이름</label>
        <input
          id={`${id}-name`}
          className="input"
          value={name}
          maxLength={60}
          required
          onChange={(e) => change(() => setName(e.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-role`}>역할</label>
        <textarea
          id={`${id}-role`}
          className="input"
          rows={2}
          value={role}
          maxLength={2000}
          onChange={(e) => change(() => setRole(e.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-tool`}>AI 도구</label>
        <select
          id={`${id}-tool`}
          className="input"
          value={tool}
          onChange={(e) =>
            change(() => {
              setTool(e.target.value);
              const next = engines.find((x) => x.name === e.target.value);
              setRuntime(runtimeFor(next?.efforts ?? [], runtime));
            })
          }
        >
          {engines.map((e) => (
            <option key={e.name} value={e.name}>
              {e.label}
            </option>
          ))}
        </select>
      </div>
      <RuntimeFields
        id={`${id}-runtime`}
        tool={tool}
        value={runtime}
        onChange={(value) => change(() => setRuntime(value))}
      />
      <BossField
        id={`${id}-boss`}
        value={reportsTo}
        agent={agent}
        agents={agents}
        ownerName={ownerName}
        onChange={(value) => change(() => setReportsTo(value))}
      />
      <RunnerField
        id={`${id}-runner`}
        value={runnerId}
        sandboxed={sandboxed}
        runners={runners}
        onChange={(value) => change(() => setRunnerId(value))}
      />
      {agent && (
        <ReviewerField
          id={`${id}-reviewer`}
          value={reviewerId}
          tool={tool}
          self={agent.id}
          agents={agents}
          onChange={(value) => change(() => setReviewerId(value))}
        />
      )}
      <AccessFields
        value={access}
        kept={agent?.approvalActions ?? []}
        tools={externalTools}
        onChange={(next) => change(() => setAccess(next))}
      />
      <LimitField
        id={`${id}-limit`}
        label="월 한도 (토큰)"
        value={limit}
        help="비우면 한도 없음. 넘기면 자동 중지 후 승인 요청"
        problem={problems.limit}
        onChange={(value) => change(() => setLimit(value))}
      />
      <LimitField
        id={`${id}-five-hour`}
        label="5시간 한도 (토큰)"
        value={fiveHour}
        help="비우면 한도 없음. 닿으면 새 작업만 쉬고 시간이 지나면 다시 시작"
        problem={problems.fiveHour}
        onChange={(value) => change(() => setFiveHour(value))}
      />
      <LimitField
        id={`${id}-plan-stop`}
        label="구독 사용률 N%에서 멈춤"
        value={planStop}
        help="1~100. 비우면 멈추지 않음. 닿으면 새 작업만 쉬고 초기화되면 다시 시작"
        problem={problems.planStop}
        onChange={(value) => change(() => setPlanStop(value))}
      />
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button type="submit" className="cta small" disabled={busy || !name.trim()}>
          {agent ? '저장' : '추가'}
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>
    </form>
  );
}
