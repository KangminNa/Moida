import { Actor, type AgentCard, Forbidden, NotFound, RuleViolation } from '../../platform';

// 운영 팀 (스토어 2단계, docs/스토어.md 10장, 2026-11-18): 앱 · 메뉴마다 팀장 하나(agent_id)를 두고, 운영 팀은 팀장과 그 아래 팀 전체다.
// 앱 · 메뉴에 글을 놓는 에이전트는 비공개를 읽지 않고(메뉴의 것은 공개된다, 원칙 5), 운영 팀이 정해져 있으면 그 팀 안이어야 한다.
// 메뉴에 운영 팀이 있으면 메뉴가, 없으면 앱이 정한다. 팀 안인지는 요청자의 보고 대상(platform AgentCard.chain)으로 본다:
// blog는 조직도를 갖지 않는다. 관리자와 기기는 늘 놓는다 (사람이 정한 것)
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. Post · PostService · MenuQuery · 앱 · 메뉴의 Service가 함께 쓴다
export class AppTeam {
  /** 요청자와 그 위 보고 대상의 id. 에이전트가 아니면 비어 있다 (팀을 보지 않는다) */
  static ranks(by: Actor, card: AgentCard | null): readonly string[] {
    if (by.kind !== 'agent' || by.id === null) return [];
    return [by.id, ...(card?.chain ?? [])];
  }

  /** 운영 팀 판단에 요청자의 보고 대상이 필요한가 (에이전트만, 트랜잭션 전에 읽는다) */
  static needsRanks(by: Actor): boolean {
    return by.kind === 'agent';
  }

  /** 놓을 수 있는가 (가까운 쪽의 운영 팀: 메뉴, 없으면 앱) */
  static allows(by: Actor, ranks: readonly string[], team: string | null): boolean {
    if (by.kind !== 'agent') return true;
    if (by.canSeePrivate()) return false;
    return team === null || ranks.includes(team);
  }

  /** 놓을 수 있는 요청자인가. where는 문구의 이름 (메뉴 · 앱) */
  static assertWriter(
    by: Actor,
    ranks: readonly string[],
    menuTeam: string | null,
    appTeam: string | null,
    where: string,
  ): void {
    if (by.kind !== 'agent') return;
    if (by.canSeePrivate())
      throw new Forbidden('app', '비공개를 읽는 에이전트는 앱에 글을 놓지 못해요');
    if (!AppTeam.allows(by, ranks, menuTeam ?? appTeam))
      throw new Forbidden('app', `${where}의 운영 팀이 아니에요`);
  }

  /**
   * 운영 팀장으로 고를 수 있는가: 있고(지운 에이전트 · 대표는 없다), 비공개를 읽지 않고,
   * 앱이면 맨 위 에이전트 (대표가 맡기는 층, O-2). 메뉴는 깊이를 보지 않는다
   */
  static assertLeader(card: AgentCard | null, forApp: boolean): void {
    if (!card) throw new NotFound('에이전트를 찾을 수 없어요');
    const where = forApp ? '앱' : '메뉴';
    if (card.scopes.includes(Actor.READ_ALL))
      throw new RuleViolation(
        `${card.name}은(는) 비공개를 읽는 에이전트라 ${where}의 운영 팀장이 될 수 없어요`,
      );
    if (forApp && card.chain.length > 0)
      throw new RuleViolation('맨 위 에이전트만 앱의 운영 팀장이 될 수 있어요');
  }
}
