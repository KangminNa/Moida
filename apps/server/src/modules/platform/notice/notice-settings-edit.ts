import type { Sql } from '../base/database';
import type { SettingShape } from '../setting/setting.view';
import type { SettingChangeInput } from '../setting/setting-change.input';
import type { NoticeSettings } from './notice-settings';
import { NoticeSettingChangeInput } from './notice-settings.input';
import { NoticeSettingsRepository } from './notice-settings.repository';

/**
 * 알림 설정 바꾸기 한 번을 부르는 쪽의 트랜잭션에서 (2026-11-15 D, task의 AgentEdit과 같은 모양).
 * 설정 바꾸기 제안의 미리 해 보기와 승인 뒤 적용이 같은 줄을 지난다 (규칙은 NoticeSettings.configure, 관리자의 저장과 같다).
 * 저장은 부르는 쪽이 정한다
 */
export class NoticeSettingsEdit {
  /** 대화로 바꾸는 알림 설정 (get_settings notices · propose_setting notice). 경로는 종류마다 한 줄로 펼친다 */
  static readonly SETTING: SettingShape = {
    setting: 'notice',
    list: 'notices',
    ops: ['edit'],
    fields: ['digest', 'digest_time', 'quiet_start', 'quiet_end', 'time_zone', 'routes'],
    target: 'one',
    versioned: true,
    grants: [],
    maps: ['routes'],
  };

  constructor(
    private readonly tx: Sql,
    private readonly spaceId: string,
    /** 등록한 알림 종류 (경로를 적을 수 있는 것) */
    private readonly known: readonly string[],
  ) {}

  /** 처음이면(행이 없으면) version 0 */
  async apply(change: SettingChangeInput, now: Date): Promise<NoticeSettings> {
    const found = await new NoticeSettingsRepository(this.tx).lock(this.spaceId);
    found.assertVersion(change.version);
    found.adjust(NoticeSettingChangeInput.from(change.body).changes, this.known, now);
    return found;
  }
}
