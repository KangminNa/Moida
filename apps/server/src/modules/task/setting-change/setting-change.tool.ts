import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import type { ApprovalProposedView } from '../approval/approval.view';
import { GetSettingsInput, ProposeSettingInput } from './setting-change.input';
import { SettingQuery } from './setting-change.query';
import { SettingChangeService } from './setting-change.service';
import type { ScheduleSettingsView, TeamSettingsView } from './setting-change.view';

// 설정 바꾸기 (2026-11-15 C, 작업 토큰): 대화에서 "설정을 바꿔 줘"를 받은 에이전트가 지금 값을 읽고(get_settings)
// 바꿀 값을 제안한다(propose_setting). 바꾸는 것은 관리자가 승인한 뒤 서버가 한다.
// 대화 상대(관리자 바로 아래)는 따로 켜지 않아도 되고, 팀원은 승인 동작에 task.setting.change를 넣어 준 경우만. 브라우저 · 커넥터 에이전트는 못 한다

@Injectable()
export class GetSettingsTool extends BaseTool {
  readonly name = 'get_settings';
  readonly scope = Actor.AGENT;
  readonly readOnly = true;
  readonly inputSchema = {
    properties: {
      kind: { type: 'string', enum: [GetSettingsInput.TEAM, GetSettingsInput.SCHEDULES] },
    },
    required: ['kind'],
  };

  constructor(private readonly settings: SettingQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<TeamSettingsView | ScheduleSettingsView> {
    return this.settings.read(actor, GetSettingsInput.from(raw));
  }
}

@Injectable()
export class ProposeSettingTool extends BaseTool {
  readonly name = 'propose_setting';
  readonly scope = Actor.AGENT;
  readonly readOnly = false;
  override readonly idempotent = true;
  readonly inputSchema = {
    properties: {
      request_id: { type: 'string', format: 'uuid' },
      setting: { type: 'string', enum: ['agent', 'schedule'] },
      op: { type: 'string', enum: ['create', 'edit', 'pause', 'resume'] },
      target_id: { type: 'string', format: 'uuid' },
      version: { type: 'integer', minimum: 1 },
      fields: { type: 'object' },
      note: { type: 'string', maxLength: 4000 },
    },
    required: ['request_id', 'setting', 'op', 'note'],
  };

  constructor(private readonly changes: SettingChangeService) {
    super();
  }

  /** 작업은 결재를 기다리므로 에이전트는 여기서 멈춘다 */
  async handle(actor: Actor, raw: unknown): Promise<ApprovalProposedView> {
    return (await this.changes.propose(actor, ProposeSettingInput.from(raw))).proposedView();
  }
}
