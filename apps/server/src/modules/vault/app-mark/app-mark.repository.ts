import { BaseRepository } from '../../platform';
import { AppMark, type LoadedAppMark } from './app-mark';

// vault.app_marks ↔ AppMark (스토어 1-2). 앱 이벤트를 받는 Handler만 쓴다. 열쇠가 app_id이고 version 대신 앱 버전을 본다.
export class AppMarkRepository extends BaseRepository<AppMark> {
  protected toEntity(row: LoadedAppMark): AppMark {
    return AppMark.restore(row);
  }

  /** 앱 하나의 사본을 잠근다. 같은 앱의 첫 이벤트가 겹쳐도 하나씩 처리하도록 행이 없어도 그 자리를 잠근다 */
  async lock(appId: string): Promise<AppMark | null> {
    const place = `vault.app_mark:${appId}`;
    await this.sql`SELECT pg_advisory_xact_lock(hashtextextended(${place}, 0))`;
    return this.maybeOne(
      await this
        .sql`SELECT *, app_id AS id FROM vault.app_marks WHERE app_id = ${appId} FOR UPDATE`,
    );
  }

  /** 받은 것이 있으면 사본을 통째로 맞춘다 */
  async save(mark: AppMark): Promise<void> {
    if (Object.keys(mark.unsaved).length === 0) return;
    const { id: _id, ...row } = mark.copy;
    await this.sql`
      INSERT INTO vault.app_marks ${this.sql(row as never)}
      ON CONFLICT (app_id) DO UPDATE SET
        public = EXCLUDED.public, app_version = EXCLUDED.app_version, updated_at = EXCLUDED.updated_at`;
  }
}
