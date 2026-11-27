'use client';

import { type FormEvent, useId, useRef, useState } from 'react';
import { flatTree } from '../../_task/labels';
import { useGoals } from '../../_task/live';
import type { Agent, Schedule } from '../../_task/types';
import { type Period, PeriodFields, periodBody, periodOf, runsPerDay } from './PeriodFields';
import { type Recipe, RecipeFields, recipeOf, TriggerFields } from './RecipeFields';

/** 하루 한도의 끝 (서버의 Schedule.DAILY_MAX_LIMIT, 5분마다 하루 내내) */
const DAILY_MAX_LIMIT = 288;

/** 이 브라우저의 시간대 (처음 정할 때의 기본값) */
function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** 저장할 때 보내는 본문 (POST · PATCH /api/schedules). 만들기의 requestId와 고치기의 version은 패널이 붙인다 */
export type ScheduleBody = {
  title: string;
  agentId: string | null;
  enabled: boolean;
  mode: string;
  atTime?: string;
  weekdays?: readonly number[];
  everyHours?: number;
  everyMinutes?: number;
  timeZone: string;
  instruction: string;
  goalId: string | null;
  /** 레시피 (2차 5단계): 어디로 · 페이지 · 받을 것 · 지킬 것 · 계기 · 앞 레시피 */
  destination: string;
  pageId: string | null;
  deliver: string | null;
  /** 회차의 답 · 실패를 관리자 메일로도 (2026-11-27) */
  mail: boolean;
  rules: string;
  trigger: string;
  afterId: string | null;
  dailyMax: number;
};

// 스케줄 하나를 만들거나 고치는 폼: 칸의 상태와 보낼 본문만 가진다. 저장은 패널이 돌린다 (onSubmit).
// 계기에 맞춰 지시대로 작업 · 대화 회차 · 페이지 새 버전이 생긴다.
// 담당을 정하고 지시를 비우면 정기 확인(맡은 목표와 진행 중인 일을 확인)이 된다 (예전의 하트비트).
// 앞 작업이 끝나지 않았거나 담당이 쉬는 중이면 그 차례는 건너뛰고, 하루 한도에 닿으면 그날은 더 만들지 않는다.
// 자동화 레시피 (2차 5단계): 계기는 TriggerFields(주기 위), 지킬 것 · 어디로 · 받을 것은 RecipeFields(지시 아래)가 그린다.
// 계기가 정한 시각이 아니면 주기 칸을 숨긴다.
export function ScheduleForm({
  schedule,
  schedules,
  agents,
  agentId: presetAgent,
  busy,
  problem,
  onSubmit,
  onEdit,
  onClose,
}: {
  /** 고칠 스케줄. 없으면 새로 만든다 */
  schedule: Schedule | null;
  /** 모든 스케줄 (앞 레시피 고르기) */
  schedules: readonly Schedule[];
  agents: readonly Agent[];
  /** 새로 만들 때 미리 고를 담당 (에이전트 화면에서 왔을 때) */
  agentId: string | null;
  busy: boolean;
  problem: string | null;
  /** 저장. 됐으면 true (만들기의 requestId는 응답을 못 받아 다시 눌러도 같게 폼이 쥔다) */
  onSubmit: (body: ScheduleBody, requestId: string) => Promise<boolean>;
  /** 칸을 고쳤다: 앞의 오류 문구를 지운다 */
  onEdit: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const goals = useGoals();
  const [title, setTitle] = useState(schedule?.title ?? '정기 확인');
  const [agentId, setAgentId] = useState(schedule?.agentId ?? presetAgent ?? '');
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true);
  const [period, setPeriod] = useState<Period>(periodOf(schedule));
  const [timeZone, setTimeZone] = useState(schedule?.timeZone ?? browserZone());
  const [goalId, setGoalId] = useState(schedule?.goalId ?? '');
  const [recipe, setRecipe] = useState<Recipe>(recipeOf(schedule));
  const [instruction, setInstruction] = useState(schedule?.instruction ?? '');
  const [dailyMax, setDailyMax] = useState(schedule?.dailyMax ?? 3);
  /** 이 주기가 하루에 돌 수 있는 횟수 (하루 한도와 견준다) */
  const perDay = runsPerDay(period);
  // 만들기: 같은 내용을 다시 보내면 같은 requestId (응답을 놓쳐 다시 눌러도 스케줄은 하나)
  const requestId = useRef<string | null>(null);
  const goalRows = flatTree(goals.data?.goals ?? [], (g) => g.parentId).filter(
    ({ item }) => item.status === 'active' || item.id === goalId,
  );

  function edit(apply: () => void) {
    requestId.current = null;
    onEdit();
    apply();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body: ScheduleBody = {
      title: title.trim(),
      agentId: agentId || null,
      enabled,
      ...periodBody(period),
      timeZone: timeZone.trim(),
      instruction: instruction.trim(),
      goalId: goalId || null,
      destination: recipe.destination,
      pageId: recipe.pageId || null,
      deliver: recipe.deliver || null,
      mail: recipe.destination === 'chat' && recipe.mail,
      rules: recipe.rules.trim(),
      trigger: recipe.trigger,
      afterId: recipe.afterId || null,
      dailyMax,
    };
    requestId.current ??= crypto.randomUUID();
    if (await onSubmit(body, requestId.current)) requestId.current = null;
  }

  const noOrder = agentId === '' && instruction.trim() === '';

  return (
    <form
      className="panel stack"
      onSubmit={submit}
      aria-label={schedule ? `${schedule.title} 편집` : '새 스케줄'}
    >
      <b>{schedule ? `${schedule.title} 편집` : '새 스케줄'}</b>
      <div className="field">
        <label htmlFor={`${id}-title`}>이름</label>
        <input
          id={`${id}-title`}
          className="input"
          value={title}
          required
          maxLength={120}
          onChange={(e) => edit(() => setTitle(e.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-agent`}>담당</label>
        <select
          id={`${id}-agent`}
          className="input"
          value={agentId}
          onChange={(e) => edit(() => setAgentId(e.target.value))}
        >
          <option value="">자동 배정</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.status === 'paused' ? `${a.name} (중지)` : a.name}
            </option>
          ))}
        </select>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={() => edit(() => setEnabled(!enabled))}
        />
        켜기
      </label>
      <TriggerFields
        id={id}
        value={recipe}
        others={schedules.filter((s) => s.id !== schedule?.id)}
        onChange={(next) => edit(() => setRecipe(next))}
      />
      {recipe.trigger === 'time' && (
        <PeriodFields id={id} value={period} onChange={(next) => edit(() => setPeriod(next))} />
      )}
      <div className="field">
        <label htmlFor={`${id}-max`}>하루 한도</label>
        <input
          id={`${id}-max`}
          className="input"
          type="number"
          min={1}
          max={DAILY_MAX_LIMIT}
          value={dailyMax}
          required
          onChange={(e) => edit(() => setDailyMax(Number(e.target.value)))}
        />
        <small>시간대 기준 하루에 저절로 만드는 작업 수 (1~288). "지금 실행"은 세지 않아요</small>
        {recipe.trigger === 'time' && perDay > dailyMax && (
          <small className="warn">
            이 주기는 하루 {perDay}번인데 한도가 {dailyMax}번이라, {dailyMax}번 만든 뒤 그날은
            멈춰요. 하루 내내 돌리려면 한도를 {perDay} 이상으로
          </small>
        )}
      </div>
      <div className="field">
        <label htmlFor={`${id}-zone`}>시간대</label>
        <input
          id={`${id}-zone`}
          className="input"
          value={timeZone}
          required
          maxLength={100}
          onChange={(e) => edit(() => setTimeZone(e.target.value))}
        />
        <small>IANA 이름 (예: Asia/Seoul)</small>
      </div>
      {goalRows.length > 0 && (
        <div className="field">
          <label htmlFor={`${id}-goal`}>목표</label>
          <select
            id={`${id}-goal`}
            className="input"
            value={goalId}
            onChange={(e) => edit(() => setGoalId(e.target.value))}
          >
            <option value="">없음</option>
            {goalRows.map(({ item, depth }) => (
              <option key={item.id} value={item.id}>
                {`${'  '.repeat(depth)}${item.title}`}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor={`${id}-text`}>지시</label>
        <textarea
          id={`${id}-text`}
          className="input"
          rows={3}
          value={instruction}
          maxLength={4000}
          placeholder={
            agentId
              ? '비우면 정기 확인: 맡은 목표와 진행 중인 일을 확인하고 할 일이 있으면 하거나 일꾼에게 맡겨요'
              : '자동 배정이면 지시가 있어야 해요'
          }
          onChange={(e) => edit(() => setInstruction(e.target.value))}
        />
        <small>앞 작업이 끝나지 않았거나 담당이 쉬는 중이면 그 차례는 건너뛰어요</small>
      </div>
      <RecipeFields id={id} value={recipe} onChange={(next) => edit(() => setRecipe(next))} />
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button
          type="submit"
          className="cta small"
          disabled={
            busy ||
            noOrder ||
            !title.trim() ||
            (recipe.trigger === 'time' && period.mode === 'daily' && period.weekdays.length === 0)
          }
        >
          저장
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>
    </form>
  );
}
