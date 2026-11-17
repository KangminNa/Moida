import type { Agent } from '../agent/agent';
import { DelegationPolicy } from './delegation.policy';
import type { JobTeamMemberView, TeamStatRow } from './job.view';

// 팀원 정보 (D1, 기획서 결정 2026-11-17 "위임 계약 · 한 층만"): 팀장이 맡길 사람을 고르는 데 필요한 것.
// 바로 아래 팀원마다 맡길 수 있는 일 · 지금 쥔 일 수 · 최근 7일의 끝냄 · 실패 · 고쳐 달라 · 반려 수 · AI 도구 ·
// 허락받았고 켜진 커넥터, 그리고 그 팀원 바로 아래 팀의 요약(사람 수 · 맡길 수 있는 일마다 몇 명, 이름은 없음).
// 팀장은 한 층만 본다: 손자 팀의 이름과 일은 보이지 않는다. 일을 빌려 줄 때 한 번 만든다 (TaskService.lease)
export class TeamRoster {
  /** 바로 아래 팀원 정보의 최근 기간 */
  static readonly RECENT_DAYS = 7;
  private static readonly DAY_MS = 86_400_000;
  private readonly stats: ReadonlyMap<string, TeamStatRow>;

  constructor(
    /** 공간의 에이전트 (지운 것은 없다) */
    private readonly org: readonly Agent[],
    stats: readonly TeamStatRow[],
  ) {
    this.stats = new Map(stats.map((s) => [s.agent_id, s]));
  }

  /** 최근 기간의 시작 (끝냄 · 실패 · 고쳐 달라를 이때부터 센다) */
  static since(now: Date): Date {
    return new Date(now.getTime() - TeamRoster.RECENT_DAYS * TeamRoster.DAY_MS);
  }

  /** 이 에이전트가 맡길 수 있는 바로 아래 팀원. 에이전트 없는 일이면 비어 있다 */
  members(manager: Agent | null): readonly JobTeamMemberView[] {
    if (manager === null) return [];
    return this.org
      .filter((a) => manager.manages(a))
      .map((member) => {
        const below = this.org.filter((a) => member.manages(a));
        const kinds: Record<string, number> = {};
        for (const kind of below.flatMap((a) => DelegationPolicy.kindsFor(a.scopes)))
          kinds[kind] = (kinds[kind] ?? 0) + 1;
        const team = below.length === 0 ? null : { members: below.length, kinds };
        const stat = this.stats.get(member.id) ?? null;
        return member.memberView(DelegationPolicy.kindsFor(member.scopes)).withStats(stat, team);
      });
  }

  /** 맡은 에이전트의 이름 (깨어난 일의 하위 작업 결과). 지웠거나 없으면 null */
  nameOf(agentId: string | null): string | null {
    return this.org.find((a) => a.id === agentId)?.name ?? null;
  }
}
