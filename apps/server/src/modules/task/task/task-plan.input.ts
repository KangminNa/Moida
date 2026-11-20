import { BaseRequest } from '../../platform';
import { TaskPlan, type TaskPlanRow } from './task-plan.policy';

/** MCP set_plan: 단계 · 완료 조건 · 하지 말 것 (2026-11-20 큰 일은 계획 먼저) */
export class SetPlanInput extends BaseRequest {
  private constructor(readonly plan: TaskPlanRow) {
    super();
  }

  static from(raw: unknown): SetPlanInput {
    return BaseRequest.read(raw, (f) => {
      const list = (name: string, max: number) =>
        (f.optionalTextList(name, max, TaskPlan.LINE_MAX) ?? [])
          .map((line) => line.trim())
          .filter(Boolean);
      return new SetPlanInput({
        steps: list('steps', TaskPlan.STEPS_MAX),
        criteria: list('criteria', TaskPlan.CRITERIA_MAX),
        mustNot: list('must_not', TaskPlan.MUST_NOT_MAX),
      });
    });
  }
}
