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
    );
  }

  /** 아래 팀 요약: 사람 수와 일의 종류마다 맡을 수 있는 사람 수. 사람이 없으면 null */
  private static teamLine(team: Json): string | null {
    const members = team.number('members');
    if (members === 0) return null;
    const kinds = team.child('kinds');
    const counts = kinds
      .keys()
      .map((kind) => `${kind} ${kinds.number(kind)}`)
      .join(', ');
    return counts ? `${members}명 (${counts})` : `${members}명`;
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
      paused: this.status === 'paused',
      bound: this.bound,
    });
  }
}
