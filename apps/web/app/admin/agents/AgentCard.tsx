import Link from 'next/link';
import { SCOPE_LABELS } from '../../_lib/types';
import {
  actionLabel,
  EFFORT_LABELS,
  engineLabel,
  PARTNER_ACTIONS,
  SETTING_CHANGE,
} from '../../_task/labels';
import { type RunnerChoice, useEngines } from '../../_task/live';
import { AgentUsage } from '../../_task/parts';
import type { Agent } from '../../_task/types';
import { MenuIcon } from '../menu';

// 팀 화면의 에이전트 카드 한 장: 이름 · 도구와 모델 · 지금 상태, 역할, 권한 칩, 사용량, 동작
export function AgentCard({
  agent,
  work,
  hold,
  boss,
  runner,
  busy,
  members,
  onFlip,
  onEdit,
  onRemove,
}: {
  agent: Agent;
  work: string | null;
  hold: string | null;
  /** 보고 대상의 이름 (없으면 관리자의 이름) */
  boss: string;
  /** 묶인 러너 (undefined: 아무 러너, null: 묶였지만 그 러너의 기기가 끊김) */
  runner?: RunnerChoice | null;
  busy: boolean;
  /** 바로 아래 팀원 수 (있으면 "팀 전체 삭제"도) */
  members: number;
  onFlip: () => void;
  onEdit: () => void;
  onRemove: (team: boolean) => void;
}) {
  const engines = useEngines();
  const paused = agent.status === 'paused';
  // 상태 점: 채움(일하는 중) · 반(쉬기 한도에 닿음) · 빈 점(멈춤 · 일 없음)
  const state = paused ? '멈춤' : (hold ?? work ?? '쉬는 중');
  const dot = paused || (!hold && !work) ? 'dot off' : hold ? 'dot half' : 'dot run';
  const tuning = [
    engineLabel(engines, agent.tool),
    agent.model || null,
    agent.effort ? `생각 ${EFFORT_LABELS[agent.effort] ?? agent.effort}` : null,
    `${boss}에게 보고`,
    runner === undefined ? null : `실행: ${runnerLabel(runner)}`,
  ];
  return (
    <article className="agent" aria-label={agent.name}>
      <div className="agent-top">
        <span className="agent-mark" aria-hidden="true">
          {agent.name.slice(0, 1)}
        </span>
        <div className="item-main">
          <b>{agent.name}</b>
          <small>{tuning.filter(Boolean).join(' · ')}</small>
        </div>
        <span className="state">
          <span className={dot} aria-hidden="true" />
          {state}
        </span>
      </div>
      {agent.role && <p className="agent-role clamp">{agent.role}</p>}
      <ul className="perm" aria-label="권한">
        {agent.scopes.map((s) => (
          <li key={s}>{SCOPE_LABELS[s] ?? s}</li>
        ))}
        {agent.externalTools.map((t) => (
          <li key={t}>
            <MenuIcon name="plug" />
            {t}
          </li>
        ))}
        {agent.approvalActions.map((a) => (
          <li key={a} className="gate">
            {actionLabel(a)} · 승인 필요
          </li>
        ))}
        {/* 대화 상대(관리자 바로 아래)는 따로 켜지 않아도 제안한다 (2026-11-15 C). 브라우저 · 커넥터면 설정은 못 바꾼다 */}
        {!agent.reportsTo &&
          PARTNER_ACTIONS.filter(
            (a) =>
              !agent.approvalActions.includes(a) &&
              (a !== SETTING_CHANGE ||
                (!agent.scopes.includes('browse') && agent.externalTools.length === 0)),
          ).map((a) => (
            <li key={a} className="gate">
              {actionLabel(a)} · 승인 필요
            </li>
          ))}
        {agent.scopes.length === 0 && agent.approvalActions.length === 0 && <li>권한 없음</li>}
      </ul>
      <AgentUsage agent={agent} />
      <div className="agent-acts">
        <button type="button" className="text-button" onClick={onEdit}>
          편집
        </button>
        <button type="button" className="text-button" disabled={busy} onClick={onFlip}>
          {paused ? '다시 시작' : '멈추기'}
        </button>
        <Link className="text-button" href={`/admin/schedules?agent=${agent.id}`}>
          {agent.schedules > 0 ? `스케줄 ${agent.schedules}개` : '스케줄 추가'}
        </Link>
        <span className="grow" />
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => onRemove(false)}
        >
          삭제
        </button>
        {members > 0 && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => onRemove(true)}
          >
            팀 전체 삭제
          </button>
        )}
      </div>
    </article>
  );
}

/** 묶인 러너의 이름과 연결 상태. 기기를 끊었으면 그 러너는 일을 빌리지 못해 일이 기다린다 */
function runnerLabel(runner: RunnerChoice | null): string {
  if (!runner) return '연결 끊긴 러너 (일이 기다려요)';
  return runner.runner.online ? runner.device.name : `${runner.device.name} (연결 안 됨)`;
}
