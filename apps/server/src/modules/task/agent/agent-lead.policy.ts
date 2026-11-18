import { RuleViolation, type Unchecked } from '../../platform';
import type { AgentRow } from '../task.tables';
import type { Agent } from './agent';

// 대표 (O-2, docs/서브나.md 14장, 기획서 결정 2026-11-18): 공간마다 숨은 에이전트 하나 (agents.lead).
// 모든 대화 · 대화로 보내는 스케줄 · 기기의 ask_agent를 받아 맨 위 에이전트(팀장)들에게 나눠 맡긴다.
// 조직도 · 팀 목록 · 설정 읽기에 보이지 않고, 아무도 대표에게 보고하지 않고, 지울 수 없다.
// 이름 · 역할 · 권한은 서버가 정한다: 권한은 read_public만이라 대표가 쓴 지시가 브라우저 팀으로 가도 비공개가 실리지 않는다.
// 관리자가 고치는 칸은 AI 도구 · 모델 · 생각 강도 · 한도뿐이다 (검토자 짝은 pairReviewer로 따로)
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. Agent와 AgentRepository가 쓴다
export class AgentLead {
  /** 새 대표의 칸 (마이그레이션 20261118160000과 같은 값). 도구는 만들 때 서버의 로그인으로 고른다 */
  static readonly FIELDS: Readonly<Partial<Unchecked<AgentRow>>> = {
    name: '대표',
    role: '대화를 받아 팀에 나눠 맡기고 결과를 모은다',
    scopes: ['read_public'],
  };
  private static readonly EDITABLE: readonly string[] = [
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
        `대표는 AI 도구 · 모델 · 생각 강도 · 한도 · 검토자만 바꿔요: ${[...fixed, ...(runnerGiven ? ['runner_id'] : [])].join(', ')}`,
      );
  }

  /** 보고 대상: 대표는 누구에게도 보고하지 않고, 아무도 대표에게 보고하지 않는다 (맨 위 에이전트는 대표가 맡긴다) */
  static assertReport(agent: Agent, manager: Agent | null): void {
    if (agent.lead && manager !== null)
      throw new RuleViolation('대표는 누구에게도 보고하지 않아요');
    if (manager?.lead)
      throw new RuleViolation('대표에게는 보고하지 않아요 (맨 위 에이전트는 대표가 맡겨요)');
  }

  /** 대표가 맡길 수 있는 에이전트: 맨 위의 지우지 않은 에이전트 전부 (대표 자신은 빼고) */
  static leads(other: Agent): boolean {
    return other.topLevel && !other.deleted && !other.lead;
  }
}
