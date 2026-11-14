import type { Agent } from './agent';

// 조직도의 계산 (Agent.reportTo의 순환 · 깊이 검사, 팀째 삭제). 상태 없이 공간의 에이전트 목록(org)만 본다.
// 삭제한 에이전트는 팀원이 아니다 (Agent.manages).
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. Agent와 AgentService가 쓴다
export class AgentOrg {
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

  /** head와 그 아래 팀 전체, 아래부터 (팀째 지울 때 팀원을 위로 올리지 않게 아래부터 지운다) */
  static teamUnder(head: Agent, org: readonly Agent[]): readonly Agent[] {
    return [...org.filter((a) => head.manages(a)).flatMap((a) => AgentOrg.teamUnder(a, org)), head];
  }
}
