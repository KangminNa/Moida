import type { SkillRevisionRow, SkillRow, TaskRunSkillSource } from '../task.tables';

// 콘솔 "스킬" 메뉴의 응답 (주인만). 저장소 판은 서버 이미지의 skills/, 콘솔 판은 task.skill_revisions다.

/** 스킬 버전 하나의 성적 (SkillQuery가 task_runs · tasks · approvals · task_events를 모은 줄) */
export interface SkillScoreRow {
  source: TaskRunSkillSource | null;
  revision: number | null;
  hash: string | null;
  tasks: number;
  done: number;
  failed: number;
  first_pass: number;
  avg_fixes: number | null;
  avg_runs: number | null;
  tokens_per_done: number | null;
  last_used: Date;
}

/** 스킬 버전 성적표의 한 줄 (끝난 일이 적으면 settled가 false: 화면이 "판단 보류"로 보인다) */
export class SkillScoreView {
  constructor(
    private readonly row: Readonly<SkillScoreRow>,
    private readonly settled: boolean,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      source: r.source,
      revision: r.revision,
      hash: r.hash,
      tasks: r.tasks,
      done: r.done,
      failed: r.failed,
      /** 수정 요청 · 반려 없이 한 번에 끝낸 일 */
      firstPass: r.first_pass,
      /** 일 하나에 관리자가 고쳐 달라거나 반려한 평균 횟수 */
      avgFixes: r.avg_fixes,
      /** 일 하나의 평균 실행 수 (다시 빌림 · 승인 뒤 이어서 · 대표의 깨움 포함) */
      avgRuns: r.avg_runs,
      tokensPerDone: r.tokens_per_done,
      lastUsed: r.last_used.toISOString(),
      settled: this.settled,
    };
  }
}

/** 스킬 목록의 한 줄 */
export class SkillSummaryView {
  constructor(
    private readonly name: string,
    private readonly description: string,
    /** 콘솔 판을 쓰고 있으면 그 줄. 없거나 저장소 판을 쓰면 null */
    private readonly row: Readonly<SkillRow> | null,
    /** 지금 쓰는 판의 해시 */
    private readonly hash: string,
    /** 콘솔 판을 쓰는데, 그 판을 만든 뒤 저장소 판이 바뀌었는가 (배포로) */
    private readonly repoChanged: boolean,
  ) {}

  toJSON() {
    const active = this.row?.active_revision ?? null;
    return {
      name: this.name,
      description: this.description,
      source: active === null ? 'repo' : 'console',
      revision: active,
      revisions: this.row?.revisions ?? 0,
      hash: this.hash,
      repoChanged: this.repoChanged,
      version: this.row?.version ?? 0,
    };
  }
}

export class SkillListView {
  constructor(private readonly skills: readonly SkillSummaryView[]) {}

  toJSON() {
    return { skills: this.skills.map((s) => s.toJSON()) };
  }
}

/** 판 목록의 한 줄 (파일은 싣지 않는다) */
export class SkillRevisionItemView {
  constructor(private readonly row: Readonly<SkillRevisionRow>) {}

  toJSON() {
    const r = this.row;
    return {
      revision: r.revision,
      hash: r.hash,
      basedOn: r.based_on,
      note: r.note,
      createdAt: r.created_at.toISOString(),
    };
  }
}

/** 판 하나 (파일까지) */
export class SkillRevisionView {
  constructor(private readonly row: Readonly<SkillRevisionRow>) {}

  toJSON() {
    return {
      ...new SkillRevisionItemView(this.row).toJSON(),
      files: this.row.files as Record<string, string>,
    };
  }
}

/** 스킬 하나: 지금 쓰는 판, 저장소 판, 콘솔 판 목록. version은 다음에 고칠 때 보낸다 (콘솔 판이 아직 없으면 0) */
export class SkillDetailView {
  constructor(
    private readonly summary: SkillSummaryView,
    /** 지금 쓰는 판의 파일 */
    private readonly files: Readonly<Record<string, string>>,
    private readonly repoHash: string,
    private readonly repoFiles: Readonly<Record<string, string>>,
    private readonly revisions: readonly Readonly<SkillRevisionRow>[],
    /** 버전마다의 성적 (최근 쓴 버전부터, 2026-11-24) */
    private readonly scores: readonly SkillScoreView[] = [],
    /** 성적표의 기간 (일) · 비율을 보이는 끝난 일의 최소 수 */
    private readonly scoreRule = { days: 0, minFinished: 0 },
  ) {}

  toJSON() {
    return {
      ...this.summary.toJSON(),
      files: this.files,
      repo: { hash: this.repoHash, files: this.repoFiles },
      revisionList: this.revisions.map((r) => new SkillRevisionItemView(r).toJSON()),
      scores: this.scores.map((s) => s.toJSON()),
      scoreDays: this.scoreRule.days,
      scoreMinFinished: this.scoreRule.minFinished,
    };
  }
}

/** 판을 쌓거나 쓸 판을 옮긴 뒤 */
export class SkillSavedView {
  constructor(private readonly row: Readonly<SkillRow>) {}

  toJSON() {
    const r = this.row;
    return {
      name: r.name,
      source: r.active_revision === null ? 'repo' : 'console',
      revision: r.active_revision,
      revisions: r.revisions,
      version: r.version,
    };
  }
}
