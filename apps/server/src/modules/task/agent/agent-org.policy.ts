import { RuleViolation } from '../../platform';
import type { Agent } from './agent';
import { AgentLead } from './agent-lead.policy';

// 조직도의 계산 (Agent.reportTo의 순환 · 깊이 검사, 팀째 삭제). 상태 없이 공간의 에이전트 목록(org)만 본다.
// 삭제한 에이전트는 팀원이 아니다 (Agent.manages). 대표(O-2)는 조직도 밖이다: 누구에게도 보고하지 않고 아무도 대표에게 보고하지 않는다
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. Agent와 AgentService가 쓴다
export class AgentOrg {
  /** 조직도의 깊이 한도. 관리자 바로 아래가 1단계 */
  static readonly DEPTH_MAX = 4;

  /**
   * agent가 managerId에게 보고해도 되는가 (null이면 관리자). org는 공간의 모든 에이전트다 (바꾸는 쪽이 모두 잠근 것).
   * 자기 자신이나 자기 아래 팀원에게 보고하면 순환이라 막고, 바꾼 뒤 가장 깊은 팀원이 DEPTH_MAX를 넘으면 막는다
   */
  static assertPlace(agent: Agent, managerId: string | null, org: readonly Agent[]): void {
    let level = 1;
    const manager = managerId === null ? null : (org.find((a) => a.id === managerId) ?? null);
    if (managerId !== null && (!manager || manager.deleted))
      throw new RuleViolation('보고 대상 에이전트가 없어요');
    AgentLead.assertReport(agent, manager);
    if (manager) {
      const above = AgentOrg.chainUp(manager, org);
      if (above.some((a) => a.id === agent.id))
        throw new RuleViolation('자기 자신이나 자기 팀원에게는 보고할 수 없어요');
      level = above.length + 1;
    }
    if (level + AgentOrg.heightOf(agent.id, org) - 1 > AgentOrg.DEPTH_MAX)
      throw new RuleViolation(`조직도는 ${AgentOrg.DEPTH_MAX}단계까지예요`);
  }

  /** agent부터 맨 위까지 (agent 포함). 저장된 조직도에 순환이 없어도 org 수만큼만 따라간다 */
  static chainUp(agent: Agent, org: readonly Agent[]): readonly Agent[] {
    const chain = [agent];
    for (let at = agent; at.reportsTo !== null && chain.length <= org.length; ) {
      const boss = org.find((a) => a.id === at.reportsTo);
      if (!boss) break;
      chain.push(boss);
      at = boss;
    }
    return chain;
  }

  /** id부터 가장 깊은 팀원까지의 단계 수 (팀원이 없으면 1) */
  static heightOf(id: string, org: readonly Agent[], seen = new Set<string>()): number {
    if (seen.has(id)) return 1;
    seen.add(id);
    const team = org.filter((a) => a.reportsTo === id && !a.deleted);
    return 1 + Math.max(0, ...team.map((a) => AgentOrg.heightOf(a.id, org, seen)));
  }

  /** 지울 에이전트들: team이면 head와 그 아래 팀 전체(아래부터), 아니면 head만. 대표는 지울 수 없다 (O-2) */
  static toDelete(head: Agent, org: readonly Agent[], team: boolean): readonly Agent[] {
    if (head.lead) throw new RuleViolation('대표는 지울 수 없어요');
    return team ? AgentOrg.teamUnder(head, org) : [head];
  }

  /** head와 그 아래 팀 전체, 아래부터 (팀째 지울 때 팀원을 위로 올리지 않게 아래부터 지운다) */
  static teamUnder(head: Agent, org: readonly Agent[]): readonly Agent[] {
    return [...org.filter((a) => head.manages(a)).flatMap((a) => AgentOrg.teamUnder(a, org)), head];
  }
}
