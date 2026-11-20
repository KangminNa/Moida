// 에이전트의 역할 설명 표준 형식 (기획서 결정 2026-11-20, ECC의 agents/*.md에서 가져옴: description · Your Role ·
// Process · Output · checklist). 첫 줄은 "언제 맡기나" 한 문장이다: 팀장(대표)은 팀원 목록에서 이 줄만 보고 고른다
// (job.view의 팀원 · 러너의 TeamMember). 그 아래는 단락 다섯(SECTIONS)과, 피드백에서 배우기 · 주간 팀 점검이 더하는 배운 규칙.
// 사람이 쓴 역할은 형식을 강제하지 않는다 (원칙 3): 팀 템플릿은 테스트가 이 형식을 보고, 주간 팀 점검은 빠진 것을 실어
// 대표가 다듬기를 propose_setting으로 제안한다. 상태 없음
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. TeamReview와 팀 템플릿 테스트가 쓴다
export class AgentRole {
  static readonly SECTIONS = [
    '하는 일',
    '일하는 순서',
    '결과 형식',
    '끝내기 전에 확인',
    '하지 않는 것',
  ] as const;
  /** 피드백에서 배우기 · 주간 팀 점검이 한 줄씩 더하는 단락 (없어도 된다) */
  static readonly LEARNED = '배운 규칙';
  /** 첫 줄(언제 맡기나)의 길이. 팀원 목록에 그대로 실린다 */
  static readonly WHEN_MAX = 120;
  /** 언제 맡기나를 가리키는 이름 (missing이 돌려준다) */
  static readonly WHEN = '언제 맡기나';

  /** 언제 맡기나: 첫 줄. 비었거나 단락 제목이면 빈 글자 */
  static when(role: string): string {
    const first = (role.split('\n')[0] ?? '').trim();
    return first.startsWith('#') ? '' : first;
  }

  /** 표준 형식에서 빠진 것: 첫 줄(언제 맡기나)이 없거나 길면 WHEN, 그리고 없거나 비어 있는 단락의 이름. 다 있으면 [] */
  static missing(role: string): string[] {
    const when = AgentRole.when(role);
    const gaps: string[] = when === '' || when.length > AgentRole.WHEN_MAX ? [AgentRole.WHEN] : [];
    const bodies = AgentRole.sections(role);
    for (const name of AgentRole.SECTIONS) if (!bodies.get(name)) gaps.push(name);
    return gaps;
  }

  /** 단락 이름 → 그 아래 글(앞뒤 빈칸 없이). 같은 이름이 두 번이면 뒤의 것 */
  private static sections(role: string): Map<string, string> {
    const found = new Map<string, string>();
    let name: string | null = null;
    let lines: string[] = [];
    const close = () => {
      if (name !== null) found.set(name, lines.join('\n').trim());
    };
    for (const line of role.split('\n')) {
      const heading = /^##\s+(.+?)\s*$/.exec(line);
      if (heading) {
        close();
        name = heading[1] ?? '';
        lines = [];
      } else lines.push(line);
    }
    close();
    return found;
  }
}
