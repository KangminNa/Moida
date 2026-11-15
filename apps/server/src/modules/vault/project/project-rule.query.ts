import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, SettingActor, type SettingChangeInput } from '../../platform';
import { projectRules } from '../vault.schema';
import {
  ProjectCollectView,
  type ProjectLine,
  ProjectRuleListView,
  ProjectSettingsView,
} from './project-rule.view';

// 프로젝트 규칙 읽기 (2차 4단계): 원문을 모을지(원문을 올리는 기기의 저장이 묻는다), 프로젝트 목록(관리자).
@Injectable()
export class ProjectRuleQuery extends BaseQuery {
  /** 이 프로젝트의 원문을 모으는가. 규칙이 없으면 모은다 */
  async collects(actor: Actor, project: string): Promise<boolean> {
    const rule = await this.row(
      projectRules,
      { space_id: actor.requireSpace(), project },
      { columns: ['collect'] },
    );
    return rule?.collect ?? true;
  }

  /** 세션에 나온 프로젝트와 규칙만 있는 프로젝트. 최근에 들어온 것부터 */
  async list(actor: Actor): Promise<ProjectRuleListView> {
    actor.assertOwner();
    return new ProjectRuleListView(await this.lines(actor.requireSpace()));
  }

  /** 대화로 바꾸는 설정 (2026-11-15 D, get_settings projects). 확인을 거친 제안자만 */
  async settings(actor: Actor): Promise<ProjectSettingsView> {
    return new ProjectSettingsView(await this.lines(SettingActor.spaceOf(actor)));
  }

  /** 제안한 프로젝트들의 지금 값 (규칙이 없으면 모은다) */
  async settingNow(actor: Actor, change: SettingChangeInput): Promise<ProjectCollectView> {
    const spaceId = SettingActor.spaceOf(actor);
    const asked = change.body.collect;
    const names =
      typeof asked === 'object' && asked !== null && !Array.isArray(asked)
        ? Object.keys(asked)
        : [];
    const rows = await this.rows(
      projectRules,
      { space_id: spaceId, project: names },
      { columns: ['project', 'collect'] },
    );
    return new ProjectCollectView(
      Object.fromEntries(names.map((p) => [p, rows.find((r) => r.project === p)?.collect ?? true])),
    );
  }

  private lines(spaceId: string): Promise<ProjectLine[]> {
    return this.sql<ProjectLine[]>`
      SELECT p.project, coalesce(r.collect, true) AS collect,
             coalesce(s.sessions, 0)::int AS sessions, s.last_at
      FROM (
        SELECT project FROM vault.sessions WHERE space_id = ${spaceId} AND project IS NOT NULL
        UNION SELECT project FROM vault.project_rules WHERE space_id = ${spaceId}
      ) p
      LEFT JOIN vault.project_rules r ON r.space_id = ${spaceId} AND r.project = p.project
      LEFT JOIN (
        SELECT project, count(*) AS sessions, max(last_revision_at) AS last_at
        FROM vault.sessions WHERE space_id = ${spaceId} GROUP BY project
      ) s ON s.project = p.project
      ORDER BY s.last_at DESC NULLS LAST, p.project`;
  }
}
