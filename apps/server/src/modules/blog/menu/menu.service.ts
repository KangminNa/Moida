import { Injectable } from '@nestjs/common';
import {
  Actor,
  Database,
  EntityService,
  Idempotency,
  RuleViolation,
  SettingActor,
  type SettingChangeInput,
  SettingOutcome,
  type Sql,
  type VersionInput,
} from '../../platform';
import { PostRepository } from '../post/post.repository';
import { Menu } from './menu';
import type { CreateMenuInput, UpdateMenuInput } from './menu.input';
import { MenuRepository } from './menu.repository';
import { MenuEdit } from './menu-edit';

// 메뉴 쓰기 (관리자만: 화면에서 바로, 또는 대화에서 AI가 제안한 것을 승인해서 2026-11-15 D, MenuEdit).
@Injectable()
export class MenuService extends EntityService<Menu> {
  private static readonly CREATE = 'create_menu';

  constructor(db: Database) {
    super(db);
  }

  protected store(tx: Sql): MenuRepository {
    return new MenuRepository(tx);
  }

  /** 같은 requestId가 다시 오면 처음 만든 메뉴를 돌려준다 */
  async create(actor: Actor, req: CreateMenuInput): Promise<Menu> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const items = this.store(tx);
      const once = new Idempotency(tx, actor.id ?? spaceId, req.requestId, MenuService.CREATE);
      const before = await once.previous();
      if (before) return items.load(spaceId, String(before.id));
      const menu = await new MenuEdit(tx, spaceId).open(req, new Date());
      await items.save(menu);
      await once.remember({ id: menu.id });
      return menu;
    });
  }

  /** 본 version이 지금과 다르면 409 */
  async update(actor: Actor, req: UpdateMenuInput): Promise<Menu> {
    actor.assertOwner();
    return this.changeAsOwner(actor, req, (menu) => menu.edit(req.changes, new Date()));
  }

  /** 설정 바꾸기 제안의 미리 해 보기 (2026-11-15 D): 같은 줄(MenuEdit)을 지나고 저장하지 않는다 */
  async rehearseSetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingActor.spaceOf(actor);
    await this.transaction(async (tx) => {
      await new MenuEdit(tx, spaceId).apply(change, new Date());
    });
  }

  /** 승인한 설정 바꾸기: 결재마다 한 번 적용하고 결과(blog.setting.changed)를 남긴다. 승인한 뒤 바뀌었으면 실패 */
  async applySetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingOutcome.spaceOf(actor, change.key);
    await SettingOutcome.settle(
      (work) => this.transaction(work),
      SettingOutcome.topicOf('blog'),
      spaceId,
      change.key,
      async (tx) => {
        await this.store(tx).save(await new MenuEdit(tx, spaceId).apply(change, new Date()));
      },
    );
  }

  /** 지운다. 안에 글 · 페이지 · 호가 있으면 422 (먼저 빼거나 옮긴다) */
  async remove(actor: Actor, req: VersionInput): Promise<void> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    await this.transaction(async (tx) => {
      const menus = this.store(tx);
      const menu = await menus.lock(spaceId, req.id);
      menu.assertVersion(req.version);
      // 휴지통의 글은 메뉴에서 빼 둔다 (앱과 휴지통에는 그대로): 목록에 보이지 않는 글이 지우기를 막지 않게
      const posts = new PostRepository(tx);
      for (const post of await posts.lockTrashedIn(spaceId, { menuId: menu.id })) {
        post.unplaceTrashed(false, actor, new Date());
        await posts.save(post);
      }
      const items = await menus.itemsIn(menu.id);
      if (items > 0)
        throw new RuleViolation(`메뉴에 ${items}개가 있어 지우지 못해요. 먼저 빼 주세요`);
      await menus.remove(menu);
    });
  }
}
