import {
  RuleViolation,
  type SettingChangeInput,
  type SettingShape,
  type Sql,
} from '../../platform';
import { AppRepository } from '../app/app.repository';
import { Menu } from './menu';
import { CreateMenuInput, UpdateMenuInput } from './menu.input';
import { MenuRepository } from './menu.repository';

/**
 * 메뉴 만들기 · 고치기 한 번을 부르는 쪽의 트랜잭션에서 (2026-11-15 D, task의 AgentEdit과 같은 모양).
 * 관리자의 만들기 · 고치기(MenuService), 설정 바꾸기 제안의 미리 해 보기, 승인 뒤 적용이 같은 줄을 지난다.
 * 운영 팀 확인(AgentDirectory)은 트랜잭션 전에 MenuService가 한다. 저장은 부르는 쪽이 정한다
 */
export class MenuEdit {
  /** 대화로 바꾸는 블로그 메뉴 (get_settings menus · propose_setting menu). 앱 · 종류는 만들 때만 */
  static readonly SETTING: SettingShape = {
    setting: 'menu',
    list: 'menus',
    ops: ['create', 'edit'],
    fields: ['app_id', 'name', 'slug', 'kind', 'policy', 'agent_id', 'rss', 'sort'],
    target: 'id',
    versioned: true,
    grants: [],
  };

  constructor(
    private readonly tx: Sql,
    private readonly spaceId: string,
  ) {}

  /** 새 메뉴 (아직 저장 전). 넣을 앱은 메뉴를 저장하는 동안 지워지지 않게 공유 잠금 (페이지 앱에는 메뉴가 없다) */
  async open(req: CreateMenuInput, now: Date): Promise<Menu> {
    const app = await new AppRepository(this.tx).holder(this.spaceId, req.appId);
    app.assertHoldsMenus();
    return Menu.open(this.spaceId, app.id, req.kind, req.fields, now);
  }

  async update(req: UpdateMenuInput, now: Date): Promise<Menu> {
    const menu = await new MenuRepository(this.tx).lock(this.spaceId, req.id);
    menu.assertVersion(req.version);
    menu.edit(req.changes, now);
    return menu;
  }

  /** 설정 바꾸기 하나: body는 get_settings와 같은 칸, key는 만들기의 requestId */
  async apply(change: SettingChangeInput, now: Date): Promise<Menu> {
    const { kind, app_id: appId, agent_id: agentId, ...fields } = change.body;
    const body = { ...fields, ...(agentId === undefined ? {} : { agentId }) };
    if (change.op === 'create')
      return this.open(CreateMenuInput.from({ ...body, kind, appId, requestId: change.key }), now);
    if (kind !== undefined || appId !== undefined)
      throw new RuleViolation('메뉴의 앱 · 종류는 만들 때만 정해요');
    return this.update(
      UpdateMenuInput.from(String(change.targetId), { ...body, version: change.version }),
      now,
    );
  }
}
