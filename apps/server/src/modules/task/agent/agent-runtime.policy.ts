import { RuleViolation } from '../../platform';

// 에이전트의 런타임 칸: 모델 · 생각 강도 (2차 7단계). 빈 글이면 AI CLI의 기본값을 쓴다.
// 강도는 도구마다 받는 값이 달라 도구와 함께 본다: 도구를 바꿀 때도, 강도를 바꿀 때도.
// 받는 값은 CLI가 알려 주는 것만 둔다 (Claude Code --effort 도움말, Codex model_reasoning_effort).
// 새 값 · 새 도구는 러너 어댑터와 함께 여기에 더한다 (maintainer의 PR).
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. Agent의 규칙이 쓴다
export class AgentRuntime {
  private static readonly MODEL_MAX = 80;
  /** 모델 이름: 영문 · 숫자 · . _ - 와 [ ] (예: 문맥 크기 표시). 설정 파일에 그대로 쓰므로 따옴표 · 공백은 받지 않는다 */
  private static readonly MODEL = /^[A-Za-z0-9._[\]-]+$/;
  /** 도구별로 받는 생각 강도 */
  private static readonly EFFORTS: Readonly<Record<string, readonly string[]>> = {
    claude: ['low', 'medium', 'high', 'xhigh', 'max'],
    codex: ['low', 'medium', 'high'],
  };
  /** 어느 도구든 받을 수 있는 값 전부 (DB CHECK와 같다) */
  static readonly ALL_EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'];

  static model(value: string): string {
    const model = value.trim();
    if (model === '') return '';
    if (model.length > AgentRuntime.MODEL_MAX || !AgentRuntime.MODEL.test(model))
      throw new RuleViolation(
        `모델 이름은 영문 · 숫자 · . _ - [ ] ${AgentRuntime.MODEL_MAX}자까지예요`,
      );
    return model;
  }

  static effort(value: string): string {
    if (value !== '' && !AgentRuntime.ALL_EFFORTS.includes(value))
      throw new RuleViolation(`생각 강도는 ${AgentRuntime.ALL_EFFORTS.join(' · ')} 중 하나예요`);
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
    const efforts = AgentRuntime.EFFORTS[tool] ?? [];
    if (!efforts.includes(effort))
      throw new RuleViolation(`${tool}의 생각 강도는 ${efforts.join(' · ')}만 돼요`);
  }
}
