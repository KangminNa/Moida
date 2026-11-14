import type { Agent } from '../../_task/types';

/** 보고 대상으로 고를 수 있는 에이전트: 자기 자신과 자기 아래 팀원은 뺀다 (서버의 Agent.reportTo가 원본) */
function bossesFor(agent: Agent | null, agents: readonly Agent[]): readonly Agent[] {
  if (!agent) return agents;
  const below = new Set([agent.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const a of agents)
      if (a.reportsTo && below.has(a.reportsTo) && !below.has(a.id)) {
        below.add(a.id);
        grew = true;
      }
  }
  return agents.filter((a) => !below.has(a.id));
}

// 에이전트 폼의 "보고 대상" 칸. 비우면 관리자에게 보고한다
export function BossField({
  id,
  value,
  agent,
  agents,
  ownerName,
  onChange,
}: {
  id: string;
  value: string;
  /** 편집하는 에이전트 (추가면 null) */
  agent: Agent | null;
  /** 공간의 모든 에이전트 */
  agents: readonly Agent[];
  /** 관리자의 이름 (보고 대상이 없으면 이 사람에게) */
  ownerName: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>보고 대상</label>
      <select
        id={id}
        className="input"
        value={value}
        aria-describedby={`${id}-help`}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{ownerName}</option>
        {bossesFor(agent, agents).map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <small id={`${id}-help`}>
        보고 대상은 이 에이전트에게 일을 나눠 맡길 수 있어요. 조직도는 4단계까지, 결재는 늘{' '}
        {ownerName}
      </small>
    </div>
  );
}
