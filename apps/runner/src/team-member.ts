import type { Json } from './json';
import type { PromptPack } from './prompt-pack';

/**
 * 일을 맡길 수 있는 바로 아래 팀원 한 명 (위임). 서버가 계산한 팀원 정보(D1, 2026-11-17)를 함께 받는다:
 * 쥔 일 수 · 최근 7일의 끝냄 · 실패 · 고쳐 달라 · 반려 수 · AI 도구 · 커넥터 · 그 아래 팀의 요약(이름 없음)
 */
export class TeamMember {
  constructor(
    readonly agentId: string,
    readonly name: string,
    readonly role: string,
    readonly status: string,
    readonly kinds: readonly string[],
    /** 정해진 러너(관리자의 컴퓨터일 수 있음)에서만 일한다: 그 컴퓨터의 폴더를 읽는 일은 이 팀원에게 */
    readonly bound = false,
    readonly tool = '',
    /** 대기 · 실행 · 기다림인 작업 수 */
    readonly open = 0,
    /** 최근 7일: 끝냄 · 실패 · 결재에서 고쳐 달라거나 반려된 수 */
    readonly done = 0,
    readonly failed = 0,
    readonly revised = 0,
    /** 허락받았고 켜진 커넥터 */
    readonly connectors: readonly string[] = [],
    /** 그 아래 팀의 요약 한 줄 (예: "2명 (general 2, browse 1)"). 없으면 null */
    readonly team: string | null = null,
    /** 최근 30일 성적표 한 줄 (2026-11-20, 예: "첫 판정 통과 3/4 · 평균 고친 횟수 0.25"). 판정 · 결정이 없으면 null */
    readonly score: string | null = null,
  ) {}

  static from(raw: Json): TeamMember {
    const recent = raw.child('recent');
    return new TeamMember(
      raw.text('agent_id'),
      raw.text('name'),
      raw.text('role'),
      raw.text('status'),
      raw.texts('kinds'),
      raw.flag('bound'),
      raw.text('tool'),
      raw.number('open'),
      recent.number('done'),
      recent.number('failed'),
      recent.number('revised'),
      raw.texts('connectors'),
      TeamMember.teamLine(raw.child('team')),
      TeamMember.scoreLine(raw.child('scorecard')),
    );
  }

  /**
   * 성적표 한 줄 (서버가 판정 · 관리자 결정 · 토큰으로 계산, 2026-11-20): 첫 판정 통과 · 평균 고친 횟수 · 관리자가 고쳐
   * 달라거나 반려한 수 · 끝낸 일 하나에 든 토큰. 셀 것이 없으면 null
   */
  private static scoreLine(card: Json): string | null {
    const judged = card.number('judged');
    const decided = card.number('decided');
    const fixes = card.optionalNumber('avg_fixes');
    const tokens = card.optionalNumber('tokens_per_done');
    const parts = [
      judged > 0 ? `첫 판정 통과 ${card.number('first_pass')}/${judged}` : '',
      fixes !== null ? `평균 고친 횟수 ${fixes}` : '',
      decided > 0 ? `관리자 반려 · 고쳐 달라 ${card.number('sent_back')}/${decided}` : '',
      tokens !== null ? `일 하나에 토큰 ${tokens}` : '',
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  /**
   * 아래 팀 전체의 요약: 사람 수, 일의 종류마다 · 켜진 커넥터마다 쓸 수 있는 사람 수 (O-2: 손자 팀까지, 이름 없이).
   * 사람이 없으면 null
   */
  private static teamLine(team: Json): string | null {
    const members = team.number('members');
    if (members === 0) return null;
    const countsOf = (field: Json) =>
      field
        .keys()
        .map((key) => `${key} ${field.number(key)}`)
        .join(', ');
    const connectors = countsOf(team.child('connectors'));
    const parts = [countsOf(team.child('kinds')), connectors ? `커넥터 ${connectors}` : '']
      .filter(Boolean)
      .join(' · ');
    return parts ? `${members}명 (${parts})` : `${members}명`;
  }

  /** 지시문의 한 줄 (틀 member). 역할은 첫 줄만 */
  line(prompts: PromptPack): string {
    return prompts.fill('member', {
      name: this.name,
      id: this.agentId,
      role: this.role.split('\n')[0]?.trim() ?? '',
      kinds: this.kinds.join(', '),
      tool: this.tool,
      open: this.open,
      done: this.done,
      failed: this.failed,
      revised: this.revised,
      connectors: this.connectors.join(', '),
      team: this.team,
      score: this.score,
      paused: this.status === 'paused',
      bound: this.bound,
    });
  }
}
