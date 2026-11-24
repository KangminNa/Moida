import { RuleViolation, type Unchecked } from '../../platform';
import type { AgentRow } from '../task.tables';
import type { Agent } from './agent';

// 대표 (O-2, docs/서브나.md 14장, 기획서 결정 2026-11-18): 공간마다 숨은 에이전트 하나 (agents.lead).
// 모든 대화 · 대화로 보내는 스케줄 · 기기의 ask_agent를 받아 일꾼 누구에게나 나눠 맡긴다 (2026-11-21 팀 없는 에이전트).
// 일꾼 목록 · 설정 읽기에 보이지 않고, 지울 수 없다. 역할은 서버가 정하고, 권한은 다른 에이전트와 같다 (전부, 비공개도 읽는다).
// 이름 (2026-11-24, 사용자 결정 "대표에게도 이름을"): 처음은 DEFAULT_NAME, 관리자가 바꾼다. 관리자는 이 이름으로 부르며 대화한다.
// 관리자가 고치는 칸은 이름 · AI 도구 · 모델 · 생각 강도 · 한도뿐이다 (검토자 짝은 pairReviewer로 따로)
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. Agent와 AgentRepository가 쓴다
export class AgentLead {
  /** 대표의 첫 이름 (마이그레이션 20261124100000이 옛 대표 "대표"도 이 이름으로 바꿨다) */
  static readonly DEFAULT_NAME = '아리';
  /** 새 대표의 칸 (마이그레이션 20261118160000과 같은 값, 이름은 DEFAULT_NAME). 도구는 만들 때 서버의 로그인으로 고른다 */
  static readonly FIELDS: Readonly<Partial<Unchecked<AgentRow>>> = {
    name: AgentLead.DEFAULT_NAME,
    role: '대화를 받아 일꾼에게 나눠 맡기고 결과를 모은다',
  };
  private static readonly EDITABLE: readonly string[] = [
    'name',
    'tool',
    'model',
    'effort',
    'monthly_limit',
    'five_hour_limit',
    'plan_stop_percent',
  ];

  /** 대표의 고치기: 고칠 수 있는 칸만, 러너에 묶지 않는다 (대화마다 도는 일이라 한 컴퓨터에 매이지 않게) */
  static assertEdit(changes: Partial<Unchecked<AgentRow>>, runnerGiven: boolean): void {
    const fixed = Object.keys(changes).filter((key) => !AgentLead.EDITABLE.includes(key));
    if (fixed.length > 0 || runnerGiven)
      throw new RuleViolation(
        `대표는 이름 · AI 도구 · 모델 · 생각 강도 · 한도 · 검토자만 바꿔요: ${[...fixed, ...(runnerGiven ? ['runner_id'] : [])].join(', ')}`,
      );
  }

  /** 검수 승인을 켤 수 있는가 (2026-11-20): 대표이고 검토자 짝이 있다 */
  static assertInspector(lead: boolean, reviewerId: string | null): void {
    if (!lead) throw new RuleViolation('검수 승인은 대표에게만 켜요');
    if (!reviewerId) throw new RuleViolation('검토자를 먼저 정해 주세요');
  }

  /**
   * 두 번째 검수자 (2026-11-20): 대표에게만, 검토자(첫 검수자)가 있어야 하고, 대표 · 검토자가 아닌 살아 있는 에이전트이며
   * 검토자와 다른 AI 도구 (같은 AI가 두 번 보면 같은 곳에서 놓친다)
   */
  static assertSecond(lead: Agent, reviewer: Agent | null, second: Agent): void {
    if (!lead.lead) throw new RuleViolation('두 번째 검수자는 대표에게만 정해요');
    if (reviewer === null) throw new RuleViolation('검토자를 먼저 정해 주세요');
    if (second.id === lead.id || second.id === reviewer.id || second.deleted)
      throw new RuleViolation('대표 · 검토자가 아닌 다른 에이전트를 골라 주세요');
    if (second.tool === reviewer.tool)
      throw new RuleViolation('두 번째 검수자는 검토자와 다른 AI 도구를 쓰는 에이전트예요');
  }

  /** 대표가 맡길 수 있는 에이전트: 지우지 않은 일꾼 전부 (대표 자신은 빼고) */
  static leads(other: Agent): boolean {
    return !other.deleted && !other.lead;
  }
}
