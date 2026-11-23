import { BaseRepository, type EntityStore, Outbox, StaleVersion } from '../../platform';
import { type LoadedTidySettings, TidySettings } from './tidy-settings';

// vault.tidy_settings ↔ TidySettings. 공간마다 한 행이고 열쇠가 space_id다. 정리 일 요청도 저장할 때 outbox로 나간다.
// 행이 없는 공간은 version 0인 꺼진 설정으로 읽고, 처음 바꿀 때 넣는다.
export class TidySettingsRepository
  extends BaseRepository<TidySettings>
  implements EntityStore<TidySettings>
{
  protected toEntity(row: LoadedTidySettings): TidySettings {
    return TidySettings.restore(row);
  }

  /** 공간의 설정을 잠근다. 행이 없으면 꺼짐으로 시작한다 */
  async lock(spaceId: string): Promise<TidySettings> {
    const found = this.maybeOne(
      await this.sql`
        SELECT *, space_id AS id FROM vault.tidy_settings WHERE space_id = ${spaceId} FOR UPDATE`,
    );
    return found ?? TidySettings.absent(spaceId);
  }

  /** 켜기 · 언제 · 하루 차례(daily_at)가 바뀌면 다음 차례도 바뀐다: 하루 정리 마감 작업을 깨운다 */
  async save(settings: TidySettings): Promise<void> {
    if (Object.keys(settings.unsaved).length > 0) {
      if (settings.version === 0) await this.insert(settings);
      else await this.update(settings);
      await new Outbox(this.sql).wake(TidySettings.DAILY_JOB);
    }
    await this.publishEvents(settings);
  }

  /** 그사이 다른 쪽이 먼저 넣었으면 Conflict */
  private async insert(settings: TidySettings): Promise<void> {
    const columns = { ...settings.unsaved, space_id: settings.id };
    const [row] = await this.sql<LoadedTidySettings[]>`
      INSERT INTO vault.tidy_settings ${this.sql(columns as never)}
      ON CONFLICT (space_id) DO NOTHING
      RETURNING *, space_id AS id`;
    if (!row) throw new StaleVersion('다른 곳에서 먼저 바뀌었어요');
    settings.saved(row);
  }

  private async update(settings: TidySettings): Promise<void> {
    const rows = await this.sql<LoadedTidySettings[]>`
      UPDATE vault.tidy_settings SET ${this.sql(settings.unsaved as never)}, version = version + 1
      WHERE space_id = ${settings.id} AND version = ${settings.version}
      RETURNING *, space_id AS id`;
    this.expectUpdated(rows.length, settings);
    settings.saved(rows[0] as LoadedTidySettings);
  }
}
