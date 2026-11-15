import { type SettingChangeInput, type SettingShape, type Sql } from '../../platform';
import { SaveTidySettingsInput } from './tidy.input';
import type { TidySettings } from './tidy-settings';
import { TidySettingsRepository } from './tidy-settings.repository';

/**
 * 세션 정리 설정 바꾸기 한 번을 부르는 쪽의 트랜잭션에서 (2026-11-15 D, task의 AgentEdit과 같은 모양).
 * 설정 바꾸기 제안의 미리 해 보기와 승인 뒤 적용이 같은 줄을 지난다 (규칙은 관리자의 저장과 같은 TidySettings.turn).
 * 저장은 부르는 쪽이 정한다
 */
export class TidyEdit {
  /** 대화로 바꾸는 세션 정리 (get_settings tidy · propose_setting tidy) */
  static readonly SETTING: SettingShape = {
    setting: 'tidy',
    list: 'tidy',
    ops: ['edit'],
    fields: ['auto_tidy', 'cadence'],
    target: 'one',
    versioned: true,
    grants: [],
  };

  constructor(
    private readonly tx: Sql,
    private readonly spaceId: string,
  ) {}

  /** 처음이면(행이 없으면) version 0. 보내지 않은 칸은 그대로 */
  async apply(change: SettingChangeInput, now: Date): Promise<TidySettings> {
    const found = await new TidySettingsRepository(this.tx).lock(this.spaceId);
    found.assertVersion(change.version);
    const { auto_tidy: autoTidy = found.autoTidy, cadence = null } = change.body;
    const req = SaveTidySettingsInput.from({ autoTidy, cadence, version: change.version });
    found.turn(req.autoTidy, req.cadence, now);
    return found;
  }
}
