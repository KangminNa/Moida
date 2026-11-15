import { Injectable } from '@nestjs/common';
import { Actor, BaseTool, SettingKinds, type ToolAnswer } from '../../platform';
import type { ApprovalProposedView } from '../approval/approval.view';
import { GetSettingsInput, ProposeSettingInput } from './setting-change.input';
import { SettingQuery } from './setting-change.query';
import { SettingChangeService } from './setting-change.service';

// 설정 바꾸기 (2026-11-15 C · D, 작업 토큰): 대화에서 "설정을 바꿔 줘"를 받은 에이전트가 지금 값을 읽고(get_settings)
// 바꿀 값을 제안한다(propose_setting). 바꾸는 것은 관리자가 승인한 뒤 서버가 한다.
// 대화 상대(관리자 바로 아래)는 따로 켜지 않아도 되고, 팀원은 승인 동작에 task.setting.change를 넣어 준 경우만. 브라우저 · 커넥터 에이전트는 못 한다.
// 바꿀 수 있는 설정은 그 설정을 가진 모듈이 platform SettingKinds에 등록한 것 (kind 없는 get_settings가 목록을 준다)

/** get_settings의 kind (등록한 설정의 list). 도구 모양을 정하는 곳이라 이름을 적어 둔다 */
const LISTS = [
  'team',
  'schedules',
  'goals',
  'menus',
  'site',
  'notices',
  'tidy',
  'projects',
  'plugins',
];
/** propose_setting의 setting */
const SETTINGS = [
  'agent',
  'schedule',
  'goal',
  'menu',
  'site',
  'notice',
  'tidy',
  'projects',
  'plugin',
];

@Injectable()
export class GetSettingsTool extends BaseTool {
  readonly name = 'get_settings';
  readonly scope = Actor.AGENT;
  readonly readOnly = true;
  readonly inputSchema = {
    properties: {
      kind: { type: 'string', enum: LISTS },
    },
  };

  constructor(
    private readonly settings: SettingQuery,
    private readonly kinds: SettingKinds,
  ) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<ToolAnswer> {
    return this.settings.read(actor, GetSettingsInput.from(raw, this.kinds));
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
      setting: { type: 'string', enum: SETTINGS },
      op: { type: 'string', enum: ['create', 'edit', 'pause', 'resume'] },
      target_id: { type: 'string', format: 'uuid' },
      target_name: { type: 'string', maxLength: 64 },
      version: { type: 'integer', minimum: 0 },
      fields: { type: 'object' },
      note: { type: 'string', maxLength: 4000 },
    },
    required: ['request_id', 'setting', 'op', 'note'],
  };

  constructor(
    private readonly changes: SettingChangeService,
    private readonly kinds: SettingKinds,
  ) {
    super();
  }

  /** 작업은 결재를 기다리므로 에이전트는 여기서 멈춘다 */
  async handle(actor: Actor, raw: unknown): Promise<ApprovalProposedView> {
    const req = ProposeSettingInput.from(raw, this.kinds);
    return (await this.changes.propose(actor, req)).proposedView();
  }
}
