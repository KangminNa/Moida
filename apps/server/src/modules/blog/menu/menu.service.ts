import { Injectable } from '@nestjs/common';
import {
  Actor,
  AgentDirectory,
  Database,
  EntityService,
  Idempotency,
  NotFound,
  RuleViolation,
  SettingActor,
  type SettingChangeInput,
  SettingOutcome,
  type Sql,
  type VersionInput,
} from '../../platform';
import type { MenuRow } from '../blog.tables';
import { Menu } from './menu';
import type { CreateMenuInput, UpdateMenuInput } from './menu.input';
import { MenuRepository } from './menu.repository';
import { MenuEdit } from './menu-edit';

// 메뉴 쓰기 (관리자만: 화면에서 바로, 또는 대화에서 AI가 제안한 것을 승인해서 2026-11-15 D, MenuEdit). 운영 팀은 트랜잭션 전에 platform AgentDirectory로 확인한다:
// 이 공간에 있고 비공개를 읽지 않는(read_all 없는) 에이전트만 (메뉴의 글은 공개된다, 원칙 5).
@Injectable()
export class MenuService extends EntityService<Menu> {
  private static readonly CREATE = 'create_menu';

  constructor(
    db: Database,
    private readonly agents: AgentDirectory,
  ) {
    super(db);
  }

  protected store(tx: Sql): MenuRepository {
    return new MenuRepository(tx);
  }

  /** 같은 requestId가 다시 오면 처음 만든 메뉴를 돌려준다 */
  async create(actor: Actor, req: CreateMenuInput): Promise<Menu> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    await this.assertTeam(actor, req.fields);
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
    await this.assertTeam(actor, req.changes);
    return this.changeAsOwner(actor, req, (menu) => menu.edit(req.changes, new Date()));
  }

  /** 설정 바꾸기 제안의 미리 해 보기 (2026-11-15 D): 같은 줄(운영 팀 확인 + MenuEdit)을 지나고 저장하지 않는다 */
  async rehearseSetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingActor.spaceOf(actor);
    await this.assertTeamOf(actor, change);
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
        await this.assertTeamOf(actor, change);
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
      const items = await menus.itemsIn(menu.id);
      if (items > 0)
        throw new RuleViolation(`메뉴에 ${items}개가 있어 지우지 못해요. 먼저 빼 주세요`);
      await menus.remove(menu);
    });
  }

  /** 설정 바꾸기의 운영 팀 (글자가 아니면 MenuEdit의 입력 검사가 막는다) */
  private assertTeamOf(actor: Actor, change: SettingChangeInput): Promise<void> {
    const agentId = change.body.agent_id;
    return this.assertTeam(actor, typeof agentId === 'string' ? { agent_id: agentId } : {});
  }

  /** 운영 팀으로 고른 에이전트: 이 공간에 있고 read_all이 없어야 한다 */
  private async assertTeam(actor: Actor, fields: Partial<MenuRow>): Promise<void> {
    if (!fields.agent_id) return;
    const agent = await this.agents.find(actor, fields.agent_id);
    if (!agent) throw new NotFound('에이전트를 찾을 수 없어요');
    if (agent.scopes.includes(Actor.READ_ALL))
      throw new RuleViolation(
        `${agent.name}은(는) 비공개를 읽는 에이전트라 메뉴의 운영 팀이 될 수 없어요`,
      );
  }
}
