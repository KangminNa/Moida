import {
  RuleViolation,
  type SettingChangeInput,
  type SettingShape,
  type Sql,
} from '../../platform';
import { ProjectRule } from './project-rule';
import { SetProjectRuleInput } from './project-rule.input';
import { ProjectRuleRepository } from './project-rule.repository';

/**
 * 프로젝트별 모으기 바꾸기 한 번을 부르는 쪽의 트랜잭션에서 (2026-11-15 D, task의 AgentEdit과 같은 모양).
 * 설정 바꾸기 제안의 미리 해 보기와 승인 뒤 적용이 같은 줄을 지난다 (규칙은 관리자의 켜고 끄기와 같은 ProjectRule.set).
 * 규칙 표에 version이 없어(늘 덮어쓴다) 제안 때 본 값과 지금 값이 같은지로 낡음을 본다. 저장은 부르는 쪽이 정한다
 */
export class ProjectRuleEdit {
  /** 대화로 바꾸는 프로젝트별 모으기 (get_settings projects · propose_setting projects). 프로젝트마다 한 줄 */
  static readonly SETTING: SettingShape = {
    setting: 'projects',
    list: 'projects',
    ops: ['edit'],
    fields: ['collect'],
    target: 'one',
    versioned: false,
    grants: [],
    maps: ['collect'],
  };
  /** 한 번에 바꾸는 프로젝트 수 */
  private static readonly MAX = 50;

  constructor(
    private readonly tx: Sql,
    private readonly spaceId: string,
  ) {}

  /** 바꿀 규칙들 (아직 저장 전). collect는 { 프로젝트: true/false } */
  async apply(change: SettingChangeInput, now: Date): Promise<ProjectRule[]> {
    const collect = change.body.collect;
    if (typeof collect !== 'object' || collect === null || Array.isArray(collect))
      throw new RuleViolation('collect는 { 프로젝트: true · false } 모양이에요');
    const entries = Object.entries(collect);
    if (entries.length === 0 || entries.length > ProjectRuleEdit.MAX)
      throw new RuleViolation(`프로젝트는 한 번에 1~${ProjectRuleEdit.MAX}개예요`);
    const reqs = entries.map(([project, on]) => SetProjectRuleInput.from({ project, collect: on }));
    const current = await new ProjectRuleRepository(this.tx).collects(
      this.spaceId,
      entries.map(([project]) => project),
    );
    change.assertUnchanged({ collect: current });
    return reqs.map((r) => ProjectRule.set(this.spaceId, r.project, r.collect, now));
  }
}
