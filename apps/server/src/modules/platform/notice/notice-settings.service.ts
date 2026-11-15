import { Injectable } from '@nestjs/common';
import { type Actor, SettingActor } from '../base/actor';
import { BaseService } from '../base/base-service';
import { Database, type Sql } from '../base/database';
import type { SettingChangeInput } from '../setting/setting-change.input';
import { SettingOutcome } from '../setting/setting-outcome';
import { NoticeCatalog } from './notice-catalog';
import type { NoticeSettings } from './notice-settings';
import type { SaveNoticeSettingsInput } from './notice-settings.input';
import { NoticeSettingsRepository } from './notice-settings.repository';
import type { NoticeSettingsView } from './notice-settings.view';
import { NoticeSettingsEdit } from './notice-settings-edit';

// 알림 설정 쓰기 (7단계). 주인만: 화면에서 바로, 또는 대화에서 AI가 제안한 것을 승인해서 (2026-11-15 D).
// 경로는 등록한 알림 종류(NoticeCatalog)에만 적을 수 있다.
@Injectable()
export class NoticeSettingsService extends BaseService {
  constructor(
    db: Database,
    private readonly catalog: NoticeCatalog,
  ) {
    super(db);
  }

  async save(actor: Actor, req: SaveNoticeSettingsInput): Promise<NoticeSettingsView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const kinds = this.catalog.all();
    const settings: NoticeSettings = await this.transaction(async (tx) => {
      const store = new NoticeSettingsRepository(tx);
      const found = await store.lock(spaceId);
      found.assertVersion(req.version);
      found.configure(
        req.settings,
        kinds.map((k) => k.kind),
        new Date(),
      );
      await store.save(found);
      return found;
    });
    return settings.view(kinds);
  }

  /** 설정 바꾸기 제안의 미리 해 보기 (2026-11-15 D): 같은 규칙(NoticeSettingsEdit)을 지나고 저장하지 않는다 */
  async rehearseSetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingActor.spaceOf(actor);
    await this.transaction(async (tx) => {
      await this.edit(tx, spaceId).apply(change, new Date());
    });
  }

  /** 승인한 설정 바꾸기: 결재마다 한 번 적용하고 결과(platform.setting.changed)를 남긴다 */
  async applySetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingOutcome.spaceOf(actor, change.key);
    await SettingOutcome.settle(
      (work) => this.transaction(work),
      SettingOutcome.topicOf('platform'),
      spaceId,
      change.key,
      async (tx) => {
        await new NoticeSettingsRepository(tx).save(
          await this.edit(tx, spaceId).apply(change, new Date()),
        );
      },
    );
  }

  private edit(tx: Sql, spaceId: string): NoticeSettingsEdit {
    return new NoticeSettingsEdit(
      tx,
      spaceId,
      this.catalog.all().map((k) => k.kind),
    );
  }
}
