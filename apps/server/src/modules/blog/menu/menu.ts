import {
  type Actor,
  BaseEntity,
  type ColumnRules,
  Forbidden,
  RuleViolation,
  TableEntity,
  ValueList,
} from '../../platform';
import { MENU_KIND, type MenuNew, type MenuRow } from '../blog.tables';
import { SlugPolicy } from '../post/slug.policy';
import { MenuView } from './menu.view';

// 메뉴 하나 (blog.menus, 2차 6단계). 공개 블로그 위쪽 메뉴 줄의 한 칸이고 주소는 /m/<주소>다.
// 종류는 만들 때만 정한다: posts(글 목록) · issues(호 목록, 매거진) · pages(페이지 모음) · page(페이지 하나).
// 편집 방침(policy)은 이 메뉴에 쓰는 AI가 읽고, 운영 팀(agent_id)은 이 메뉴에 쓰는 에이전트 하나다
// (task의 값이라 외래키 없음. 비공개를 읽지 않는 에이전트인지는 Service가 platform AgentDirectory로 본다).
// 메뉴는 설정이라 판을 남기지 않는다. 안이 비어야 지운다 (MenuService.remove).
export class Menu extends TableEntity<MenuRow, MenuNew> {
  static readonly POSTS = 'posts';
  static readonly ISSUES = 'issues';
  static readonly PAGES = 'pages';
  static readonly PAGE = 'page';
  static readonly NAME_MAX = 40;
  static readonly SLUG_MAX = 60;
  static readonly POLICY_MAX = 4000;
  static readonly SORT_MAX = 1000;

  /** 주인이 정하는 칸과 그 규칙 */
  private static readonly RULES: ColumnRules<MenuRow> = {
    name: (value) => {
      const name = value.trim();
      if (name.length < 1 || name.length > Menu.NAME_MAX)
        throw new RuleViolation(`메뉴 이름은 1~${Menu.NAME_MAX}자예요`);
      return name;
    },
    slug: (value) => {
      const slug = SlugPolicy.check(value);
      if (slug.length > Menu.SLUG_MAX)
        throw new RuleViolation(`메뉴 주소는 ${Menu.SLUG_MAX}자까지예요`);
      return slug;
    },
    sort: (value) => {
      if (!Number.isInteger(value) || value < 0 || value > Menu.SORT_MAX)
        throw new RuleViolation(`순서는 0~${Menu.SORT_MAX}예요`);
      return value;
    },
    policy: (value) => {
      if (value.length > Menu.POLICY_MAX)
        throw new RuleViolation(`편집 방침은 ${Menu.POLICY_MAX}자까지예요`);
      return value.trim();
    },
    agent_id: (value) => value,
    rss: (value) => value,
  };

  /** 새 메뉴. 주소를 정하지 않으면 이름에서 만든다 (겹치면 409, Service) */
  static open(spaceId: string, kind: string, fields: Partial<MenuRow>, now: Date): Menu {
    if (!ValueList.has(MENU_KIND, kind))
      throw new RuleViolation(`메뉴 종류는 ${MENU_KIND.join(' · ')} 중 하나예요`);
    const name = fields.name ?? '';
    const slug = fields.slug ?? SlugPolicy.fromTitle(name).slice(0, Menu.SLUG_MAX);
    const menu = new Menu(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        name,
        slug,
        kind,
        created_at: now,
        updated_at: now,
      },
      true,
    );
    menu.accept(
      { sort: 0, policy: '', agent_id: null, rss: true, ...fields, name, slug },
      Menu.RULES,
    );
    return menu;
  }

  static restore(row: MenuRow): Menu {
    return new Menu(row);
  }

  get spaceId(): string {
    return this.row.space_id;
  }

  get kind(): string {
    return this.row.kind;
  }

  /** 운영 팀 (에이전트 id). 없으면 null */
  get agentId(): string | null {
    return this.row.agent_id;
  }

  /** 주인이 고친 칸을 적는다. 종류는 바꾸지 않는다 */
  edit(changes: Partial<MenuRow>, now: Date): void {
    const before = this.row;
    this.accept(changes, Menu.RULES);
    if (this.row !== before) this.put('updated_at', now);
  }

  /** 이 메뉴에 담을 수 있는가: 글은 글 목록, 페이지는 페이지 모음 · 페이지 하나, 호는 호 목록 */
  assertHolds(thing: 'post' | 'page' | 'issue'): void {
    const fits =
      (thing === 'post' && this.row.kind === Menu.POSTS) ||
      (thing === 'page' && (this.row.kind === Menu.PAGES || this.row.kind === Menu.PAGE)) ||
      (thing === 'issue' && this.row.kind === Menu.ISSUES);
    if (!fits)
      throw new RuleViolation(`${this.row.name}(${this.row.kind}) 메뉴에는 담을 수 없어요`);
  }

  /**
   * 이 메뉴에 올릴 수 있는 요청자 (메뉴의 것은 공개된다, 원칙 5): 관리자와 기기는 늘, 에이전트는 비공개를 읽지 않고
   * 운영 팀이 정해져 있으면 그 에이전트만
   */
  assertWriter(by: Actor): void {
    if (by.kind !== 'agent') return;
    if (by.canSeePrivate())
      throw new Forbidden('menu', '비공개를 읽는 에이전트는 메뉴에 올리지 못해요');
    if (this.row.agent_id !== null && this.row.agent_id !== by.id)
      throw new Forbidden('menu', `${this.row.name} 메뉴의 운영 팀이 아니에요`);
  }

  view(): MenuView {
    return new MenuView(this.row);
  }
}
