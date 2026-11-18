'use client';

import { type FormEvent, useId, useState } from 'react';
import { useEngines } from '../../_task/live';
import type { Agent } from '../../_task/types';
import { LimitField } from '../agents/LimitField';
import { ReviewerField } from '../agents/ReviewerField';
import { type Runtime, RuntimeFields, runtimeFor } from '../agents/RuntimeFields';

/** 빈 칸은 한도 없음. 맞지 않는 값이면 undefined (에이전트 폼과 같은 규칙) */
function limitOf(text: string, max = Number.MAX_SAFE_INTEGER): number | null | undefined {
  const value = text.trim();
  if (value === '') return null;
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= max ? limit : undefined;
}

/** 대표의 고치기 본문 (PATCH /api/agents/:id). 서버가 받는 칸은 이것뿐이다 (AgentLead) */
export type LeadBody = Runtime & {
  tool: string;
  monthlyLimit: number | null;
  fiveHourLimit: number | null;
  planStopPercent: number | null;
  reviewerId: string | null;
};

// 대표의 설정 (O-2, 설정 › AI): AI 도구 · 모델 · 생각 강도 · 한도 · 검토자. 이름 · 역할 · 권한은 서버가 정한다
export function LeadForm({
  lead,
  agents,
  busy,
  problem,
  onSubmit,
}: {
  lead: Agent;
  /** 검토자로 고를 수 있는 에이전트 (목록의 에이전트, 대표는 없다) */
  agents: readonly Agent[];
  busy: boolean;
  problem: string | null;
  onSubmit: (body: LeadBody) => void;
}) {
  const id = useId();
  const engines = useEngines();
  const [tool, setTool] = useState<string>(lead.tool);
  const [runtime, setRuntime] = useState<Runtime>({ model: lead.model, effort: lead.effort });
  const [reviewerId, setReviewerId] = useState(lead.reviewerId ?? '');
  const [limit, setLimit] = useState(lead.monthlyLimit?.toString() ?? '');
  const [fiveHour, setFiveHour] = useState(lead.fiveHourLimit?.toString() ?? '');
  const [planStop, setPlanStop] = useState(lead.planStopPercent?.toString() ?? '');
  const [problems, setProblems] = useState<Record<string, string>>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const monthlyLimit = limitOf(limit);
    const fiveHourLimit = limitOf(fiveHour);
    const planStopPercent = limitOf(planStop, 100);
    setProblems({
      ...(monthlyLimit === undefined ? { limit: '1 이상의 정수를 입력해 주세요' } : {}),
      ...(fiveHourLimit === undefined ? { fiveHour: '1 이상의 정수를 입력해 주세요' } : {}),
      ...(planStopPercent === undefined ? { planStop: '1~100 사이의 정수를 입력해 주세요' } : {}),
    });
    if (monthlyLimit === undefined || fiveHourLimit === undefined || planStopPercent === undefined)
      return;
    onSubmit({
      tool,
      model: runtime.model.trim(),
      effort: runtime.effort,
      monthlyLimit,
      fiveHourLimit,
      planStopPercent,
      reviewerId: reviewerId || null,
    });
  }

  return (
    <form className="panel" onSubmit={submit} aria-label="대표 설정">
      <div className="field">
        <label htmlFor={`${id}-tool`}>AI 도구</label>
        <select
          id={`${id}-tool`}
          className="input"
          value={tool}
          onChange={(e) => {
            setTool(e.target.value);
            const next = engines.find((x) => x.name === e.target.value);
            setRuntime(runtimeFor(next?.efforts ?? [], runtime));
          }}
        >
          {engines.map((e) => (
            <option key={e.name} value={e.name}>
              {e.label}
            </option>
          ))}
        </select>
      </div>
      <RuntimeFields id={`${id}-runtime`} tool={tool} value={runtime} onChange={setRuntime} />
      <ReviewerField
        id={`${id}-reviewer`}
        value={reviewerId}
        tool={tool}
        self={lead.id}
        agents={agents}
        onChange={setReviewerId}
      />
      <LimitField
        id={`${id}-limit`}
        label="월 한도 (토큰)"
        value={limit}
        help="비우면 한도 없음. 넘기면 자동 중지 후 승인 요청"
        problem={problems.limit}
        onChange={setLimit}
      />
      <LimitField
        id={`${id}-five-hour`}
        label="5시간 한도 (토큰)"
        value={fiveHour}
        help="비우면 한도 없음. 닿으면 새 대화의 일만 쉬고 시간이 지나면 다시 시작"
        problem={problems.fiveHour}
        onChange={setFiveHour}
      />
      <LimitField
        id={`${id}-plan-stop`}
        label="구독 사용률 N%에서 멈춤"
        value={planStop}
        help="1~100. 비우면 멈추지 않음"
        problem={problems.planStop}
        onChange={setPlanStop}
      />
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button type="submit" className="cta small" disabled={busy}>
          {busy ? '저장 중' : '저장'}
        </button>
      </div>
    </form>
  );
}
