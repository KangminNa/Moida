'use client';

import { type FormEvent, useId, useState } from 'react';
import { useEngines } from '../../_task/live';
import type { Agent } from '../../_task/types';
import { SaveButton } from '../../_ui/SaveButton';
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
  /** 대표의 이름 (2026-11-24): 관리자가 대화에서 부르는 이름 */
  name: string;
  tool: string;
  monthlyLimit: number | null;
  fiveHourLimit: number | null;
  planStopPercent: number | null;
  reviewerId: string | null;
  /** 검수 승인 (2026-11-20): 검토자가 검수해 통과하면 앱 안의 공개(글 · 앱 화면)를 관리자 대신 승인 */
  reviewerApproves: boolean;
  /** 두 번째 검수자 (2026-11-20, 선택): 검토자와 다른 AI 도구. 둘 다 통과해야 공개 */
  secondInspectorId: string | null;
};

// 대표의 설정 (O-2, 설정 › AI): 이름 · AI 도구 · 모델 · 생각 강도 · 한도 · 검토자 · 검수 승인. 역할 · 권한은 서버가 정한다
export function LeadForm({
  lead,
  agents,
  busy,
  saved,
  problem,
  onSubmit,
}: {
  lead: Agent;
  /** 검토자로 고를 수 있는 에이전트 (목록의 에이전트, 대표는 없다) */
  agents: readonly Agent[];
  busy: boolean;
  /** 방금 저장이 끝났는지 (버튼이 잠깐 체크) */
  saved: boolean;
  problem: string | null;
  onSubmit: (body: LeadBody) => void;
}) {
  const id = useId();
  const engines = useEngines();
  const [name, setName] = useState(lead.name);
  const [tool, setTool] = useState<string>(lead.tool);
  const [runtime, setRuntime] = useState<Runtime>({ model: lead.model, effort: lead.effort });
  const [reviewerId, setReviewerId] = useState(lead.reviewerId ?? '');
  const [approves, setApproves] = useState(lead.reviewerApproves);
  const [secondId, setSecondId] = useState(lead.secondInspectorId ?? '');
  const reviewerTool = agents.find((a) => a.id === reviewerId)?.tool ?? '';
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
      ...(name.trim() === '' ? { name: '이름을 적어 주세요' } : {}),
      ...(monthlyLimit === undefined ? { limit: '1 이상의 정수를 입력해 주세요' } : {}),
      ...(fiveHourLimit === undefined ? { fiveHour: '1 이상의 정수를 입력해 주세요' } : {}),
      ...(planStopPercent === undefined ? { planStop: '1~100 사이의 정수를 입력해 주세요' } : {}),
    });
    if (
      name.trim() === '' ||
      monthlyLimit === undefined ||
      fiveHourLimit === undefined ||
      planStopPercent === undefined
    )
      return;
    onSubmit({
      name: name.trim(),
      tool,
      model: runtime.model.trim(),
      effort: runtime.effort,
      monthlyLimit,
      fiveHourLimit,
      planStopPercent,
      reviewerId: reviewerId || null,
      reviewerApproves: approves && reviewerId !== '',
      secondInspectorId: approves && reviewerId !== '' && secondId !== '' ? secondId : null,
    });
  }

  return (
    <form className="panel" onSubmit={submit} aria-label="대표 설정">
      <div className="field">
        <label htmlFor={`${id}-name`}>이름</label>
        <input
          id={`${id}-name`}
          className="input"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
        <small>대화에서 이 이름으로 불러요</small>
        {problems.name && <p className="error">{problems.name}</p>}
      </div>
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
      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={approves && reviewerId !== ''}
            disabled={reviewerId === ''}
            onChange={(e) => setApproves(e.target.checked)}
          />
          검수 통과면 바로 공개
        </label>
        <small>
          앱의 글 공개 · 앱 화면 공개는 검토자가 시중의 비슷한 결과물 · AI 말투 · 완료 조건으로
          검수해요. 고칠 것은 일꾼에게 돌려보내고(3번까지), 통과하면 승인 없이 공개해요. 권한 ·
          에이전트 · 플러그인 · 설정 바꾸기는 늘 승인을 받아요
        </small>
      </div>
      {approves && reviewerId !== '' && (
        <ReviewerField
          id={`${id}-second`}
          label="두 번째 검수자"
          help="검토자와 다른 AI 도구의 에이전트가 따로 한 번 더 검수해요. 둘 다 통과해야 공개해요 (검수 비용 두 배)"
          value={secondId}
          tool={reviewerTool}
          self={lead.id}
          agents={agents}
          onChange={setSecondId}
        />
      )}
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
        <SaveButton busy={busy} saved={saved} className="cta small" />
      </div>
    </form>
  );
}
