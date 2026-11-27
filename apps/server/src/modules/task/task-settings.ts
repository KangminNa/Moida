import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SettingKinds } from '../platform';
import { AgentService } from './agent/agent.service';
import { AgentEdit } from './agent/agent-edit';
import { ConnectorEdit } from './external-tool/connector-edit';
import { ExternalToolQuery } from './external-tool/external-tool.query';
import { ExternalToolService } from './external-tool/external-tool.service';
import { GoalQuery } from './goal/goal.query';
import { GoalService } from './goal/goal.service';
import { GoalEdit } from './goal/goal-edit';
import { ScheduleService } from './schedule/schedule.service';
import { ScheduleEdit } from './schedule/schedule-edit';
import { SettingChanges } from './setting-change/setting-change.policy';
import { SettingQuery } from './setting-change/setting-change.query';

// task가 가진 설정 중 대화로 바꾸는 것 (2026-11-15 C · D): 에이전트 · 스케줄(레시피) · 목표 · 커넥터 켜기 · 끄기(C4, 2026-11-27).
// 무엇을 바꿀 수 있는지는 Edit의 SETTING, 읽기는 Query, 미리 해 보기 · 적용은 Service (관리자의 고치기와 같은 Edit)
@Injectable()
export class TaskSettings implements OnModuleInit {
  constructor(
    private readonly kinds: SettingKinds,
    private readonly settings: SettingQuery,
    private readonly agents: AgentService,
    private readonly schedules: ScheduleService,
    private readonly goals: GoalService,
    private readonly goalQuery: GoalQuery,
    private readonly connectors: ExternalToolService,
    private readonly connectorQuery: ExternalToolQuery,
  ) {}

  onModuleInit(): void {
    this.kinds.register({
      ...AgentEdit.SETTING,
      read: (a) => this.settings.team(a),
      current: async (a, c) => (await this.settings.agentNow(a, c))?.toJSON() ?? null,
      rehearse: (a, c) => this.agents.rehearseSetting(a, c),
      apply: (a, c) => this.agents.applySetting(a, c),
      // C에서 결재에 실은 모양 (관리자 REST 본문) 그대로
      bodyOf: (fields) => SettingChanges.restBody(fields),
    });
    this.kinds.register({
      ...ScheduleEdit.SETTING,
      read: (a) => this.settings.schedules(a),
      current: async (a, c) => (await this.settings.scheduleNow(a, c))?.toJSON() ?? null,
      rehearse: (a, c) => this.schedules.rehearseSetting(a, c),
      apply: (a, c) => this.schedules.applySetting(a, c),
      // 고치기는 설정 전부를 받으므로 지금 값 위에 얹는다
      bodyOf: (fields, now) =>
        SettingChanges.restBodyOver(ScheduleEdit.SETTING.fields ?? [], fields, now),
    });
    this.kinds.register({
      ...GoalEdit.SETTING,
      read: (a) => this.goalQuery.settings(a),
      current: async (a, c) => (await this.goalQuery.settingNow(a, c))?.toJSON() ?? null,
      rehearse: (a, c) => this.goals.rehearseSetting(a, c),
      apply: (a, c) => this.goals.applySetting(a, c),
    });
    this.kinds.register({
      ...ConnectorEdit.SETTING,
      read: (a) => this.connectorQuery.settings(a),
      current: async (a, c) => (await this.connectorQuery.settingNow(a, c)).toJSON(),
      rehearse: (a, c) => this.connectors.rehearseSetting(a, c),
      apply: (a, c) => this.connectors.applySetting(a, c),
    });
  }
}
