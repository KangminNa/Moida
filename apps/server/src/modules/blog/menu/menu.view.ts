import type { IssueRow, MenuRow } from '../blog.tables';

// 메뉴의 읽기 모양 (2차 6단계). 웹이 `import type`으로 가져온다 (객체설계 6장).
// 보는 사람마다 둘이다: 관리자는 설정 칸 전부와 담긴 수, 방문자는 메뉴 줄에 필요한 이름 · 주소 · 종류만.

/** 메뉴 한 줄과 함께 읽는 칸: 담긴 글 · 페이지 · 호의 수 */
export interface MenuListRow extends MenuRow {
  items: number;
}

/** 메뉴 하나 (관리자) */
export class MenuView {
  constructor(
    private readonly row: Readonly<MenuRow>,
    /** 담긴 글 · 페이지 · 호의 수 (만들거나 고친 결과에는 없다) */
    private readonly items: number | null = null,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      name: r.name,
      /** 바깥 주소 /m/<slug> */
      slug: r.slug,
      /** posts(글 목록) · issues(호 목록) · pages(페이지 모음) · page(페이지 하나) */
      kind: r.kind,
      /** 편집 방침 (이 메뉴에 쓰는 AI가 읽는다) */
      policy: r.policy,
      /** 운영 팀 (에이전트 id) */
      agentId: r.agent_id,
      rss: r.rss,
      sort: r.sort,
      items: this.items,
      version: r.version,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  }
}

/** 메뉴 목록 (관리자). 메뉴 줄의 순서대로 */
export class MenuListView {
  constructor(private readonly rows: readonly Readonly<MenuListRow>[]) {}

  toJSON() {
    return { menus: this.rows.map((r) => new MenuView(r, Number(r.items)).toJSON()) };
  }
}

/** 공개 블로그의 메뉴 줄 (방문자 · 기기). 설정 칸은 싣지 않는다 */
export class PublicMenuListView {
  constructor(private readonly rows: readonly Readonly<MenuRow>[]) {}

  toJSON() {
    return {
      menus: this.rows.map((r) => ({ name: r.name, slug: r.slug, kind: r.kind, rss: r.rss })),
    };
  }
}

/** blog_menus의 답: 글을 쓸 AI가 고를 메뉴와 편집 방침, 호 목록 메뉴에는 만드는 중인 호. MCP는 snake_case */
export class ToolMenuView {
  constructor(
    private readonly rows: readonly Readonly<MenuRow>[],
    private readonly drafts: readonly Readonly<
      Pick<IssueRow, 'id' | 'menu_id' | 'number' | 'title'>
    >[],
  ) {}

  toJSON() {
    return {
      menus: this.rows.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        policy: r.policy,
        agent_id: r.agent_id,
        issues: this.drafts
          .filter((i) => i.menu_id === r.id)
          .map((i) => ({ id: i.id, number: i.number, title: i.title })),
      })),
    };
  }
}

/** 대화로 바꾸는 메뉴 한 줄 (2026-11-15 D, get_settings menus). MCP라 snake_case, 칸 이름은 propose_setting의 fields와 같다 */
export class MenuSettingView {
  constructor(private readonly row: Readonly<MenuRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      version: r.version,
      name: r.name,
      slug: r.slug,
      kind: r.kind,
      policy: r.policy,
      agent_id: r.agent_id,
      rss: r.rss,
      sort: r.sort,
    };
  }
}

/** get_settings { kind: menus }: 메뉴 줄의 순서대로 */
export class MenuSettingsView {
  constructor(private readonly rows: readonly MenuRow[]) {}

  toJSON() {
    return { menus: this.rows.map((r) => new MenuSettingView(r).toJSON()) };
  }
}
