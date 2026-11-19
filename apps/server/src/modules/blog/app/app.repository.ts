import { Conflict, Database, NotFound, TableRepository } from '../../platform';
import { apps } from '../blog.schema';
import type { AppRow } from '../blog.tables';
import { App } from './app';

// blog.apps ↔ App. 불러오기 · 잠그기 · 저장(바뀐 칸만, version으로 늦은 쓰기를 막는다)은 기반이 한다.
export class AppRepository extends TableRepository<AppRow, App> {
  protected readonly table = apps;
  protected readonly noun = '앱';

  protected toEntity(row: AppRow): App {
    return App.restore(row);
  }

  /** 그사이 다른 앱이 같은 주소를 차지했으면 사람이 읽을 오류로 */
  override async save(app: App): Promise<void> {
    try {
      await super.save(app);
    } catch (error) {
      if (Database.isUniqueViolation(error, 'apps_space_id_slug_key'))
        throw new Conflict('이미 쓰는 앱 주소예요');
      throw error;
    }
  }

  /**
   * 메뉴 · 글 · 페이지를 넣을 앱 (같은 공간). 넣는 동안 앱이 지워지지 않게 공유 잠금으로 읽는다.
   * 페이지 앱에 페이지를 넣을 때는 하나만 들어가도록 쓰기 잠금
   */
  async holder(spaceId: string, id: string, exclusive = false): Promise<App> {
    const [row] = await this.sql<AppRow[]>`
      SELECT * FROM blog.apps WHERE space_id = ${spaceId} AND id = ${id}
      ${exclusive ? this.sql`FOR UPDATE` : this.sql`FOR SHARE`}`;
    if (!row) throw new NotFound('앱을 찾을 수 없어요');
    return this.toEntity(row);
  }

  /** 공간의 앱을 모두 쓰기 잠금 (첫 화면 고정이 공간마다 하나이게, 스토어 2단계). 늘 id 순서로 잠근다 */
  async lockAll(spaceId: string): Promise<App[]> {
    const rows = await this.sql<AppRow[]>`
      SELECT * FROM blog.apps WHERE space_id = ${spaceId} ORDER BY id FOR UPDATE`;
    return rows.map((row) => this.toEntity(row));
  }

  /** 이 공간에서 다른 앱이 쓰는 주소인가 (exceptId: 고치는 앱 자신) */
  async slugTaken(spaceId: string, slug: string, exceptId: string | null): Promise<boolean> {
    const [row] = await this.sql<{ taken: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM blog.apps WHERE space_id = ${spaceId} AND slug = ${slug}
          ${exceptId === null ? this.sql`` : this.sql`AND id <> ${exceptId}`}
      ) AS taken`;
    return row?.taken ?? false;
  }

  /** 앱에 든 글(휴지통 포함) · 페이지 · 호의 수. 모두 없어야 지운다 (빈 메뉴는 함께 지운다) */
  async contents(appId: string): Promise<{ posts: number; pages: number; issues: number }> {
    const [row] = await this.sql<{ posts: number; pages: number; issues: number }[]>`
      SELECT (SELECT count(*) FROM blog.posts WHERE app_id = ${appId})::int AS posts,
             (SELECT count(*) FROM blog.pages WHERE app_id = ${appId})::int AS pages,
             (SELECT count(*) FROM blog.issues i JOIN blog.menus m ON m.id = i.menu_id
              WHERE m.app_id = ${appId})::int AS issues`;
    return row ?? { posts: 0, pages: 0, issues: 0 };
  }

  /** 지운다 (설정이라 판을 남기지 않는다). 안의 메뉴는 부르는 쪽이 먼저 지운다. 지운 것을 알린다 (App.remove) */
  async remove(app: App): Promise<void> {
    await this.deleteRows(apps, { space_id: app.spaceId, id: app.id });
    await this.publishEvents(app);
  }
}
