import { Injectable } from '@nestjs/common';
import { type Actor, SettingActor } from '../base/actor';
import { BaseQuery } from '../base/base-query';
import { Database } from '../base/database';
import { NoticeCatalog } from './notice-catalog';
import { NoticeSettingsRepository } from './notice-settings.repository';
import type { NoticeSettingsView, NoticeSettingView } from './notice-settings.view';

// 알림 설정 읽기 (7단계). 주인만. 등록한 종류마다 지금의 경로를 함께 준다 (설정 화면이 종류를 모른다).
@Injectable()
export class NoticeSettingsQuery extends BaseQuery {
  constructor(
    db: Database,
    private readonly catalog: NoticeCatalog,
  ) {
    super(db);
  }

  async get(actor: Actor): Promise<NoticeSettingsView> {
    actor.assertOwner();
    const settings = await new NoticeSettingsRepository(this.sql).load(actor.requireSpace());
    return settings.view(this.catalog.all());
  }

  /** 대화로 바꾸는 설정의 지금 값 (2026-11-15 D, get_settings notices). 확인을 거친 제안자만 */
  async setting(actor: Actor): Promise<NoticeSettingView> {
    const settings = await new NoticeSettingsRepository(this.sql).load(SettingActor.spaceOf(actor));
    return settings.settingView(this.catalog.all());
  }
}
