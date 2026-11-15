import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery, NotFound, SettingActor, type SettingChangeInput } from '../../platform';
import { issues, menus } from '../blog.schema';
import type { MenuListRow } from './menu.view';
import {
  MenuListView,
  MenuSettingsView,
  MenuSettingView,
  PublicMenuListView,
  ToolMenuView,
} from './menu.view';

// 메뉴 읽기 (2차 6단계). 메뉴의 이름 · 주소 · 종류는 공개다 (공개 블로그의 메뉴 줄). 설정 칸은 관리자만.
// AI 도구는 호 목록 메뉴에 만드는 중인 호를 함께 받는다 (blog_save_draft의 issue_id)
// 방문자는 공간을 모른다: MVP는 공간 하나라 방문자 읽기는 공간으로 거르지 않는다 (blog 규칙).
@Injectable()
export class MenuQuery extends BaseQuery {
  /** 메뉴 줄의 순서대로. 관리자는 설정 칸과 담긴 수까지, 그 밖에는 이름 · 주소 · 종류만 */
  async list(actor: Actor): Promise<MenuListView | PublicMenuListView> {
    if (actor.kind !== 'owner') return new PublicMenuListView(await this.publicRows());
    const rows = await this.sql<MenuListRow[]>`
      SELECT m.*,
        (SELECT count(*) FROM blog.posts p WHERE p.menu_id = m.id AND p.deleted_at IS NULL)
          + (SELECT count(*) FROM blog.pages g WHERE g.menu_id = m.id)
          + (SELECT count(*) FROM blog.issues i WHERE i.menu_id = m.id) AS items
      FROM blog.menus m WHERE m.space_id = ${actor.requireSpace()}
      ORDER BY m.sort, m.created_at, m.id`;
    return new MenuListView(rows);
  }

  /** blog_menus: 글을 쓸 AI가 고를 메뉴와 편집 방침 (write 권한) */
  async forTool(actor: Actor): Promise<ToolMenuView> {
    actor.assertCan(Actor.WRITE);
    const spaceId = actor.requireSpace();
    const drafts = await this.rows(
      issues,
      { space_id: spaceId, status: 'draft' },
      { order: ['number'], columns: ['id', 'menu_id', 'number', 'title'] },
    );
    return new ToolMenuView(
      await this.rows(menus, { space_id: spaceId }, { order: ['sort', 'created_at'] }),
      drafts,
    );
  }

  /** 대화로 바꾸는 메뉴 (2026-11-15 D, get_settings menus). 확인을 거친 제안자만 */
  async settings(actor: Actor): Promise<MenuSettingsView> {
    const spaceId = SettingActor.spaceOf(actor);
    return new MenuSettingsView(
      await this.rows(menus, { space_id: spaceId }, { order: ['sort', 'created_at', 'id'] }),
    );
  }

  /** 제안의 지금 값. 만들기면 null */
  async settingNow(actor: Actor, change: SettingChangeInput): Promise<MenuSettingView | null> {
    const spaceId = SettingActor.spaceOf(actor);
    if (change.targetId === null) return null;
    const row = await this.row(menus, { space_id: spaceId, id: change.targetId });
    if (!row) throw new NotFound('메뉴를 찾을 수 없어요');
    return new MenuSettingView(row);
  }

  private publicRows() {
    return this.rows(menus, {}, { order: ['sort', 'created_at'] });
  }
}
