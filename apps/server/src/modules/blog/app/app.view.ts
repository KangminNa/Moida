import type { AppRow } from '../blog.tables';

// 앱의 읽기 모양 (스토어 1단계). 웹이 `import type`으로 가져온다 (객체설계 6장).
// 보는 사람마다 둘이다: 관리자는 칸 전부와 든 것의 수, 방문자는 공개 앱의 아이콘 목록에 필요한 것만 (id는 내보내지 않는다).

/** 아이콘 주소. 내용의 해시가 붙어 바뀌면 주소도 바뀐다. 없으면 null (화면이 종류의 선 아이콘을 그린다) */
function iconUrl(r: Readonly<AppRow>): string | null {
  return r.icon_blob_hash
    ? `/api/apps/by-slug/${r.slug}/icon?v=${r.icon_blob_hash.slice(0, 12)}`
    : null;
}

/** 앱 한 줄과 함께 읽는 칸: 든 것의 수 (관리자 목록) */
export interface AppListRow extends AppRow {
  published: number;
  drafts: number;
  menus: number;
  pages: number;
}

/** 앱 하나 (관리자) */
export class AppView {
  constructor(
    private readonly row: Readonly<AppRow>,
    /** 든 것의 수 (만들거나 고친 결과에는 없다) */
    private readonly counts: Readonly<
      Pick<AppListRow, 'published' | 'drafts' | 'menus' | 'pages'>
    > | null = null,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      /** blog(블로그) · magazine(매거진) · page(페이지 앱) */
      kind: r.kind,
      name: r.name,
      /** 바깥 주소 /<slug> */
      slug: r.slug,
      description: r.description,
      /** private(비공개) · public(공개) */
      visibility: r.visibility,
      sort: r.sort,
      iconUrl: iconUrl(r),
      /** 운영 팀장 (에이전트 id, 스토어 2단계). 운영 팀은 그 에이전트와 그 아래 팀. 없으면 null */
      agentId: r.agent_id,
      /** 편집 방침 (이 앱에 쓰는 AI가 읽는다) */
      policy: r.policy,
      /** 방문자 첫 화면(/)으로 고정했는가 */
      home: r.home,
      /** 공개 글 · 임시 글(휴지통 제외) · 메뉴 · 페이지의 수 */
      counts: this.counts,
      version: r.version,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  }
}

/** 앱 목록 (관리자). 순서대로 */
export class AppListView {
  constructor(private readonly rows: readonly Readonly<AppListRow>[]) {}

  toJSON() {
    return {
      apps: this.rows.map((r) =>
        new AppView(r, {
          published: Number(r.published),
          drafts: Number(r.drafts),
          menus: Number(r.menus),
          pages: Number(r.pages),
        }).toJSON(),
      ),
    };
  }
}

/** 공개 앱 하나 (방문자 · 기기): 앱 목록 · 앱 머리 */
export class PublicAppView {
  constructor(private readonly row: Readonly<AppRow>) {}

  toJSON() {
    const r = this.row;
    return {
      kind: r.kind,
      name: r.name,
      slug: r.slug,
      description: r.description,
      iconUrl: iconUrl(r),
      /** 첫 화면(/)으로 고정한 앱 (스토어 2단계): 웹의 /가 이 앱으로 보낸다 */
      home: r.home,
    };
  }
}

/** 공개 앱 목록 (방문자의 첫 화면). 순서대로 */
export class PublicAppListView {
  constructor(private readonly rows: readonly Readonly<AppRow>[]) {}

  toJSON() {
    return { apps: this.rows.map((r) => new PublicAppView(r).toJSON()) };
  }
}

/** 대화로 바꾸는 앱 한 줄 (get_settings apps). MCP라 snake_case, 칸 이름은 propose_setting의 fields와 같다 */
export class AppSettingView {
  constructor(private readonly row: Readonly<AppRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      version: r.version,
      name: r.name,
      slug: r.slug,
      kind: r.kind,
      description: r.description,
      sort: r.sort,
      /** 운영 팀장 (맨 위 에이전트, 스토어 2단계). 이 앱의 일은 이 에이전트에게 맡긴다. 없으면 null */
      agent_id: r.agent_id,
      /** 편집 방침 */
      policy: r.policy,
      /** 읽기만: 공개는 관리자가 앱 관리에서 바꾼다 */
      visibility: r.visibility,
      /** 읽기만: 방문자 첫 화면으로 고정했는가 (관리자가 바꾼다) */
      home: r.home,
    };
  }
}

/** get_settings { kind: apps }: 순서대로 */
export class AppSettingsView {
  constructor(private readonly rows: readonly AppRow[]) {}

  toJSON() {
    return { apps: this.rows.map((r) => new AppSettingView(r).toJSON()) };
  }
}
