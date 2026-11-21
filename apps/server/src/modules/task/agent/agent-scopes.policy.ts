import { RuleViolation, ValueList } from '../../platform';
import { AGENT_SCOPE, type AgentScope } from '../task.tables';

// 에이전트의 권한 (Agent의 scopes 규칙). 2026-11-21부터 팀 없는 같은 일꾼이라 모든 에이전트가 모든 권한을 갖는다:
// 비공개 읽기 · 초안 · 브라우저 · 코드 · 만들기 · 커넥터를 한 에이전트가 함께 쓴다 (사용자 결정 "비공개도 그냥 읽어").
// 바깥으로 바뀌는 동작은 원칙 7대로 승인 뒤, 비밀값은 AI를 거치지 않는다 (원칙 8). 칸의 일(code · make)은 빌릴 때 칸 러너로 간다
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. Agent의 규칙과 커넥터가 함께 쓴다
export class AgentScopes {
  /** 에이전트에게 주는 권한 전부. run은 러너의 것이라 없다: 에이전트가 스스로 일을 빌릴 수 없게 */
  static readonly ALL: readonly AgentScope[] = AGENT_SCOPE;
  /** 한 에이전트에 붙일 수 있는 외부 도구 수 (DB CHECK와 같다) */
  private static readonly TOOLS_MAX = 10;

  /** 에이전트의 권한: 늘 전부다. 모르는 이름이 오면 막는다 (옛 판 · 잘못된 입력) */
  static check(value: readonly string[]): AgentScope[] {
    const unknown = value.filter((s) => !ValueList.has(AgentScopes.ALL, s));
    if (unknown.length > 0)
      throw new RuleViolation(`에이전트에게 줄 수 없는 권한이에요: ${unknown.join(', ')}`);
    return [...AgentScopes.ALL];
  }

  /** 외부 도구 이름 목록의 규칙 (Agent의 external_tools 칸): 개수, 겹친 이름은 하나로 */
  static tools(value: readonly string[]): string[] {
    if (value.length > AgentScopes.TOOLS_MAX)
      throw new RuleViolation(`외부 도구는 ${AgentScopes.TOOLS_MAX}개까지예요`);
    return [...new Set(value)];
  }

  /** 도구 name을 더 붙일 수 없는 까닭. 붙일 수 있으면 null (제안의 결재를 실행하기 전에) */
  static toolProblem(tools: readonly string[], name: string): string | null {
    if (!tools.includes(name) && tools.length >= AgentScopes.TOOLS_MAX)
      return `외부 도구는 ${AgentScopes.TOOLS_MAX}개까지예요`;
    return null;
  }
}
