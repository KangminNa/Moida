import { RuleViolation, ValueList } from '../../platform';
import { Engines } from '../ai/engines';
import {
  AGENT_EFFORT,
  AGENT_TOOL,
  type AgentEffort,
  type AgentTool,
  CHAT_EFFORT,
} from '../task.tables';

// 에이전트의 런타임 칸: 모델 · 생각 강도 (2차 7단계). 빈 글이면 AI CLI의 기본값을 쓴다.
// 강도는 도구마다 받는 값이 달라 도구와 함께 본다: 도구를 바꿀 때도, 강도를 바꿀 때도.
// 받는 값은 엔진 목록(task/engines.json의 efforts, 리팩토링 E1)에 CLI가 알려 주는 것만 둔다
// (Claude Code --effort 도움말, Codex model_reasoning_effort). 새 값 · 새 도구는 러너 어댑터와 함께 그 파일에 더한다.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. Agent의 규칙이 쓴다
export class AgentRuntime {
  private static readonly MODEL_MAX = 80;
  /** 모델 이름: 영문 · 숫자 · . _ - 와 [ ] (예: 문맥 크기 표시). 설정 파일에 그대로 쓰므로 따옴표 · 공백은 받지 않는다 */
  private static readonly MODEL = /^[A-Za-z0-9._[\]-]+$/;
  /** AI 도구 (agents.tool의 값 목록) */
  static tool(value: string): AgentTool {
    if (!ValueList.has(AGENT_TOOL, value))
      throw new RuleViolation(`AI 도구는 ${AGENT_TOOL.join(' · ')} 중 하나예요`);
    return value;
  }

  static model(value: string): string {
    const model = value.trim();
    if (model === '') return '';
    if (model.length > AgentRuntime.MODEL_MAX || !AgentRuntime.MODEL.test(model))
      throw new RuleViolation(
        `모델 이름은 영문 · 숫자 · . _ - [ ] ${AgentRuntime.MODEL_MAX}자까지예요`,
      );
    return model;
  }

  /** 빈 글(CLI의 기본)이나 어느 도구든 받을 수 있는 값 (agents.effort의 값 목록, 대화의 값 목록은 빈 글만 없다) */
  static effort(value: string): AgentEffort {
    if (!ValueList.has(AGENT_EFFORT, value))
      throw new RuleViolation(`생각 강도는 ${CHAT_EFFORT.join(' · ')} 중 하나예요`);
    return value;
  }

  /**
   * 대화가 정해 둔 모델 · 강도로 회차 작업에 실을 칸 (payload.runtime, 2026-11-15 B). 정한 것이 없으면 빈 객체.
   * 상대의 도구가 바뀌어 강도가 맞지 않으면 RuleViolation (조용히 빼지 않는다)
   */
  static turnPayload(
    tool: string,
    model: string | null,
    effort: string | null,
  ): Record<string, unknown> {
    if (!model && !effort) return {};
    AgentRuntime.assertFits(tool, effort ?? '');
    return { runtime: { model: model ?? '', effort: effort ?? '' } };
  }

  /** 이 도구가 이 강도를 받는가. 도구 · 강도를 다 바꾼 뒤에 한 번 본다 */
  static assertFits(tool: string, effort: string): void {
    if (effort === '') return;
    Engines.of(tool).assertEffort(effort);
  }
}
