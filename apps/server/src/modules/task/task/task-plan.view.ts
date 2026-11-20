// set_plan의 답 (2026-11-20 큰 일은 계획 먼저): 서버가 고정한 계획 그대로. 웹은 쓰지 않는다 (MCP 답)

/** 정한 계획: 다시 정할 수 없다 (fixed) */
export class PlanSetView {
  constructor(
    private readonly steps: readonly string[],
    private readonly criteria: readonly string[],
    private readonly mustNot: readonly string[],
  ) {}

  toJSON() {
    return { fixed: true, steps: this.steps, criteria: this.criteria, must_not: this.mustNot };
  }
}
