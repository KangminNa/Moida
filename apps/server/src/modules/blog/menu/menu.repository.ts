import { Database, NotFound, RuleViolation, TableRepository } from '../../platform';
import { menus } from '../blog.schema';
import type { MenuRow } from '../blog.tables';
import { Menu } from './menu';

// blog.menus ↔ Menu. 불러오기 · 잠그기 · 저장(바뀐 칸만, version으로 늦은 쓰기를 막는다)은 기반이 한다.
export class MenuRepository extends TableRepository<MenuRow, Menu> {
  protected readonly table = menus;
  protected readonly noun = '메뉴';

  protected toEntity(row: MenuRow): Menu {
    return Menu.restore(row);
  }

  /** 그사이 다른 메뉴가 같은 주소를 차지했으면 사람이 읽을 오류로 */
  override async save(menu: Menu): Promise<void> {
    try {
      await super.save(menu);
    } catch (error) {
      if (Database.isUniqueViolation(error, 'menus_space_id_slug_key'))
        throw new RuleViolation('이미 쓰는 메뉴 주소예요');
      throw error;
    }
  }

  /**
   * 글 · 페이지 · 호를 올릴 메뉴 (같은 공간). 올리는 동안 메뉴가 지워지지 않게 공유 잠금으로 읽는다.
   * 페이지 하나 메뉴는 넣을 때 하나만 들어가도록 쓰기 잠금 (pages)
   */
  async holder(spaceId: string, id: string, exclusive = false): Promise<Menu> {
    const [row] = await this.sql<MenuRow[]>`
      SELECT * FROM blog.menus WHERE space_id = ${spaceId} AND id = ${id}
      ${exclusive ? this.sql`FOR UPDATE` : this.sql`FOR SHARE`}`;
    if (!row) throw new NotFound('메뉴를 찾을 수 없어요');
    return this.toEntity(row);
  }

  /** 메뉴에 담긴 글(휴지통 포함) · 페이지 · 호의 수. 비어야 지운다 */
  async itemsIn(menuId: string): Promise<number> {
    const [row] = await this.sql<{ items: number }[]>`
      SELECT (SELECT count(*) FROM blog.posts WHERE menu_id = ${menuId})::int
        + (SELECT count(*) FROM blog.pages WHERE menu_id = ${menuId})::int
        + (SELECT count(*) FROM blog.issues WHERE menu_id = ${menuId})::int AS items`;
    return row?.items ?? 0;
  }

  /** 지운다 (설정이라 판을 남기지 않는다) */
  async remove(menu: Menu): Promise<void> {
    await this.deleteRows(menus, { space_id: menu.spaceId, id: menu.id });
  }
}
