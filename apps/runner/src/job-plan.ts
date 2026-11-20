import type { Json } from './json';
import type { PromptPack } from './prompt-pack';

/**
 * 이 일의 계획 (payload.plan, 2026-11-20 큰 일은 계획 먼저): 맡은 에이전트가 set_plan으로 한 번 정한 단계 · 완료 조건 ·
 * 하지 말 것. 서버가 고정해 두어 바꿀 수 없고, 검토 · 검수도 이 완료 조건으로 판정한다. 깨어난 일에 다시 보여 준다
 */
export class JobPlan {
  constructor(
    readonly steps: readonly string[],
    readonly criteria: readonly string[],
    readonly mustNot: readonly string[],
  ) {}

  static from(payload: Json): JobPlan | null {
    if (!payload.field('plan')) return null;
    const plan = payload.child('plan');
    const criteria = plan.texts('criteria');
    return criteria.length === 0
      ? null
      : new JobPlan(plan.texts('steps'), criteria, plan.texts('mustNot'));
  }

  /** 지시문 단락 (틀 plan) */
  part(prompts: PromptPack): string {
    const list = (lines: readonly string[]) => lines.map((line) => `- ${line}`).join('\n') || null;
    return prompts.fill('plan', {
      steps: list(this.steps),
      criteria: list(this.criteria),
      mustNot: list(this.mustNot),
    });
  }
}
