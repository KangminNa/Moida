import type { AgentRow, PlanUsageRow } from '../task.tables';

// 사용량의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 표의 칸 중 무엇을 내보내는지는 여기 한 곳에만 적는다.

/**
 * 에이전트 하나의 성적표 (2026-11-20 평가가 남는 팀, AgentRepository.scores): 최근 기간의 판정 · 관리자 결정 · 토큰.
 * judged · first_pass는 같은 대상의 첫 판정 수와 그중 통과, avg_fixes는 판정받은 대상 하나에 고칠 것 판정 수(없으면 null),
 * decided · sent_back은 관리자가 정한 결재 수와 그중 수정 요청 · 반려, tokens_per_done은 끝낸 일 하나에 든 토큰
 */
export interface AgentScoreRow {
  agent_id: string;
  judged: number;
  first_pass: number;
  avg_fixes: number | null;
  decided: number;
  sent_back: number;
  done: number;
  tokens_per_done: number | null;
}

/** 에이전트 하나의 토큰 사용량과 한도 */
export class AgentUsageView {
  constructor(
    private readonly row: Readonly<AgentRow>,
    /** 지난 5시간에 쓴 토큰 */
    private readonly fiveHourTokens: number,
    /** 이번 달에 쓴 토큰 */
    private readonly monthTokens: number,
    /** 새 일을 쉬는 중인가. 저장하지 않고 읽을 때 계산한다 */
    private readonly holding: boolean,
  ) {}

  /** 최근 기간의 성적표 (팀 화면, 2026-11-20). 없으면 null로 내보낸다 */
  private score: Readonly<AgentScoreRow> | null = null;
  private scoreDays = 0;

  withScore(score: Readonly<AgentScoreRow> | null, days: number): this {
    this.score = score;
    this.scoreDays = days;
    return this;
  }

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      fiveHourTokens: this.fiveHourTokens,
      monthTokens: this.monthTokens,
      fiveHourLimit: r.five_hour_limit,
      monthlyLimit: r.monthly_limit,
      planStopPercent: r.plan_stop_percent,
      holding: this.holding,
      scorecard: this.scorecard(),
    };
  }

  private scorecard() {
    const s = this.score;
    if (s === null) return null;
    return {
      days: this.scoreDays,
      judged: s.judged,
      firstPass: s.first_pass,
      avgFixes: s.avg_fixes,
      decided: s.decided,
      sentBack: s.sent_back,
      done: s.done,
      tokensPerDone: s.tokens_per_done,
    };
  }
}

/** 구독 사용률 창 하나. percent와 resetsAt이 null이면 확인 전이다 (본 적 없거나 초기화 시각이 지남) */
export class PlanWindowView {
  constructor(
    private readonly tool: string,
    private readonly window: string,
    /** 러너가 본 값. 본 적 없으면 null */
    private readonly row: Readonly<PlanUsageRow> | null,
    /** 초기화 시각 전인가 */
    private readonly valid: boolean,
  ) {}

  toJSON() {
    const valid = this.valid ? this.row : null;
    return {
      tool: this.tool,
      window: this.window,
      percent: valid?.percent ?? null,
      resetsAt: valid?.resets_at.toISOString() ?? null,
      seenAt: this.row?.seen_at.toISOString() ?? null,
    };
  }
}

/** 홈의 사용량 */
export class UsageView {
  constructor(
    private readonly agents: readonly AgentUsageView[],
    private readonly plan: readonly PlanWindowView[],
  ) {}

  toJSON() {
    return {
      agents: this.agents.map((a) => a.toJSON()),
      plan: this.plan.map((p) => p.toJSON()),
    };
  }
}
