import type { ProjectRuleRow } from '../vault.tables';

/** 프로젝트 하나: 세션에 나온 프로젝트와 규칙을 합친 줄 (규칙이 없으면 모은다) */
export interface ProjectLine extends Pick<ProjectRuleRow, 'project' | 'collect'> {
  sessions: number;
  last_at: Date | null;
}

/** 프로젝트 목록 (관리자): 세션 수 · 마지막으로 들어온 때 · 모으는가 */
export class ProjectRuleListView {
  constructor(private readonly rows: readonly ProjectLine[]) {}

  toJSON() {
    return {
      projects: this.rows.map((r) => ({
        project: r.project,
        collect: r.collect,
        sessions: r.sessions,
        lastAt: r.last_at?.toISOString() ?? null,
      })),
    };
  }
}

/** 대화로 바꾸는 프로젝트별 모으기 (2026-11-15 D, get_settings projects). MCP라 snake_case */
export class ProjectSettingsView {
  constructor(private readonly rows: readonly ProjectLine[]) {}

  toJSON() {
    return {
      projects: this.rows.map((r) => ({
        project: r.project,
        collect: r.collect,
        sessions: r.sessions,
      })),
    };
  }
}

/** 제안한 프로젝트들의 지금 값 (바뀐 줄의 바탕): { collect: { 프로젝트: 모으는가 } } */
export class ProjectCollectView {
  constructor(private readonly collect: Readonly<Record<string, boolean>>) {}

  toJSON() {
    return { collect: this.collect };
  }
}
