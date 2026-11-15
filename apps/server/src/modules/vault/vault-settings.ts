import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SettingKinds, SettingOneView } from '../platform';
import { ProjectRuleQuery } from './project/project-rule.query';
import { ProjectRuleService } from './project/project-rule.service';
import { ProjectRuleEdit } from './project/project-rule-edit';
import { TidyQuery } from './tidy/tidy.query';
import { TidyService } from './tidy/tidy.service';
import { TidyEdit } from './tidy/tidy-edit';

// vault가 가진 설정 중 대화로 바꾸는 것 (2026-11-15 D): 세션 정리 · 프로젝트별 모으기.
// 세션 · wiki의 내용은 설정이 아니라 작업 · 변경 묶음으로 다룬다
@Injectable()
export class VaultSettings implements OnModuleInit {
  constructor(
    private readonly kinds: SettingKinds,
    private readonly tidyQuery: TidyQuery,
    private readonly tidy: TidyService,
    private readonly projectQuery: ProjectRuleQuery,
    private readonly projects: ProjectRuleService,
  ) {}

  onModuleInit(): void {
    this.kinds.register({
      ...TidyEdit.SETTING,
      read: async (a) => new SettingOneView('tidy', await this.tidyQuery.setting(a)),
      current: async (a) => (await this.tidyQuery.setting(a)).toJSON(),
      rehearse: (a, c) => this.tidy.rehearseSetting(a, c),
      apply: (a, c) => this.tidy.applySetting(a, c),
    });
    this.kinds.register({
      ...ProjectRuleEdit.SETTING,
      read: (a) => this.projectQuery.settings(a),
      current: async (a, c) => (await this.projectQuery.settingNow(a, c)).toJSON(),
      rehearse: (a, c) => this.projects.rehearseSetting(a, c),
      apply: (a, c) => this.projects.applySetting(a, c),
    });
  }
}
