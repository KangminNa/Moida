import { RuleViolation, ValueList } from '../../platform';

// 모델 상한 (2026-11-19 사용자 결정): 관리자가 정한 모델(대화의 모델, 없으면 대표 · 팀장 에이전트의 모델)이 상한이고,
// 그 아래 팀의 모델은 맡기는 쪽이 일마다 상한 이하에서 고른다 (delegate_task의 model, 승인 없음).
// 등급은 Claude Code의 모델만: haiku < sonnet < opus. 빈 글은 CLI의 기본(구독 계정은 Opus)이라 opus로 센다.
// 모르는 이름은 가장 높게 센다 (상한을 넘지 못하게). Fable은 AgentRuntime.model이 아예 받지 않는다.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. DelegationPolicy가 쓴다
export class ModelTier {
  /** 맡길 때 고를 수 있는 모델 (낮은 것부터, Claude Code의 별칭) */
  static readonly CHOICES = ['haiku', 'sonnet', 'opus'] as const;
  /** 등급을 쓰는 AI 도구 */
  private static readonly TOOL = 'claude';

  /** 등급: haiku 0 · sonnet 1 · opus(와 빈 글 · 모르는 이름) 2 */
  static rank(model: string): number {
    const name = model.toLowerCase();
    if (name.includes('haiku')) return 0;
    if (name.includes('sonnet')) return 1;
    return 2;
  }

  /**
   * 하위 작업이 쓸 모델. 빈 글이면 팀원의 설정 그대로 (상한 안).
   * ceiling: 맡기는 일이 쓰는 모델(빈 글 = CLI 기본). chosen: 맡기는 쪽이 고른 별칭(없으면 null). 상한을 넘게 고르면 422.
   * 고르지 않았는데 팀원의 설정이 상한보다 높으면 상한으로 낮춘다 (관리자가 정한 모델이 위). Claude Code가 아닌 팀원은 등급이 없어 그대로
   */
  static forSubtask(
    ceiling: string,
    chosen: string | null,
    worker: { tool: string; model: string },
  ): string {
    if (chosen !== null && !ValueList.has(ModelTier.CHOICES, chosen))
      throw new RuleViolation(`model은 ${ModelTier.CHOICES.join(' · ')} 가운데 하나예요`);
    if (worker.tool !== ModelTier.TOOL) return '';
    if (chosen !== null) {
      if (ModelTier.rank(chosen) > ModelTier.rank(ceiling))
        throw new RuleViolation(
          `이 일은 ${ModelTier.label(ceiling)}보다 높은 모델로 맡길 수 없어요`,
        );
      return chosen;
    }
    if (ModelTier.rank(worker.model) <= ModelTier.rank(ceiling)) return '';
    return ceiling;
  }

  /** 화면 · 오류 문구의 모델 이름 (빈 글은 CLI 기본) */
  static label(model: string): string {
    return model === '' ? 'opus' : model;
  }
}
