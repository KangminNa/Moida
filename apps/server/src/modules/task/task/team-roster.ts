import type { Agent } from '../agent/agent';
import { DelegationPolicy } from './delegation.policy';
import type { JobTeamMemberView, TeamStatRow } from './job.view';

// 일꾼 정보 (D1, 기획서 결정 2026-11-17): 대표가 맡길 사람을 고르는 데 필요한 것.
// 일꾼마다 맡길 수 있는 일 · 지금 쥔 일 수 · 최근 7일의 끝냄 · 실패 · 고쳐 달라 · 반려 수 · AI 도구 · 허락받았고 켜진 커넥터 · 성적표.
// 팀은 없앴다 (2026-11-21): 모든 에이전트가 같은 일꾼이고 대표만 나눠 맡긴다 (한 층).
// 일을 빌려 줄 때 한 번 만든다 (JobService.lease)
export class TeamRoster {
  /** 바로 아래 팀원 정보의 최근 기간 */
  static readonly RECENT_DAYS = 7;
  /** 성적표의 기간 (2026-11-20): 판정 · 관리자 결정은 드물어 일주일로는 비율이 흔들린다 */
  static readonly SCORE_DAYS = 30;
  /** 성적표의 관리자 결정에서 빼는 동작: 결과 카드(고르기) · 로그인했어요(품질이 아님) */
  static readonly SCORE_SKIP: readonly string[] = ['task.chat.result', 'browser.site.login'];
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

  /** 성적표 기간의 시작 */
  static scoreSince(now: Date): Date {
    return new Date(now.getTime() - TeamRoster.SCORE_DAYS * TeamRoster.DAY_MS);
  }

  /** 이 에이전트가 맡길 수 있는 일꾼 (대표만). 에이전트 없는 일이면 비어 있다 */
  members(manager: Agent | null): readonly JobTeamMemberView[] {
    if (manager === null) return [];
    return this.org
      .filter((a) => manager.manages(a))
      .map((member) => {
        const stat = this.stats.get(member.id) ?? null;
        return member.memberView(DelegationPolicy.kindsFor(member.scopes)).withStats(stat);
      });
  }

  /** 맡은 에이전트의 이름 (깨어난 일의 하위 작업 결과). 지웠거나 없으면 null */
  nameOf(agentId: string | null): string | null {
    return this.org.find((a) => a.id === agentId)?.name ?? null;
  }
}
