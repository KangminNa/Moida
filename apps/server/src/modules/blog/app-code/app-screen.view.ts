import type { AppRow, IssueRow, MenuRow, PageRow, PostRow } from '../blog.tables';

// 앱 화면 하나의 데이터 (스토어 1-6, 데이터 약속 cairn: 1, docs/스토어.md 9.3). 웹이 앱 코드의 템플릿(Mustache)에 채우고,
// 같은 값을 <script id="cairn-data">로 싣는다. 약속은 이름을 더하기만 한다 (빼거나 바꾸면 cairn: 2).
// 방문자 데이터만 담는다: 누가 보든(관리자 · 미리 보기 토큰도) 같은 모양이고, 보이는지는 Query가 앱을 정할 때 이미 걸렀다.
// 웹이 더하는 것: 날짜 글자(dateText), 글 본문의 HTML(post.html), 사이트 이름(site.name).
// 앱 도메인으로 연 화면(스토어 3-0)은 그 앱의 주소가 도메인의 뿌리(/)이고, 기본 도메인에 있는 것(사이트 첫 화면 · 로그인 · 그래프 ·
// 페이지 · 다른 앱)은 기본 도메인의 전체 주소로 적는다. 연결을 확인한 도메인이 있는 다른 앱은 어디서든 그 도메인으로 적는다.

/** 글 목록 한 줄과 함께 읽는 칸 */
export interface ScreenPostRow
  extends Pick<PostRow, 'slug' | 'title' | 'excerpt' | 'tags' | 'published_at'> {}

/** 글 하나와 함께 읽는 칸: 지금 판의 본문, 올린 메뉴의 주소 */
export interface ScreenArticleRow
  extends Pick<
    PostRow,
    'slug' | 'title' | 'excerpt' | 'tags' | 'published_at' | 'align' | 'status'
  > {
  body: string | null;
  menu_slug: string | null;
}

/** 호 안의 글 한 줄 */
export interface ScreenIssuePostRow extends Pick<PostRow, 'slug' | 'title' | 'excerpt'> {}

const enc = encodeURIComponent;

function iconOf(r: Readonly<AppRow>): string | null {
  return r.icon_blob_hash
    ? `/api/apps/by-slug/${r.slug}/icon?v=${r.icon_blob_hash.slice(0, 12)}`
    : null;
}

export class AppScreenDataView {
  /**
   * 앱 하나의 바깥 주소 (끝에 / 없이): 연결을 확인한 도메인이면 https://<도메인>, 아니면 기본 도메인의 /<slug>.
   * site: 기본 도메인의 출처 (기본 도메인에서 그리면 ""). 다른 앱에 든 글로 보낼 때도 쓴다 (AppScreenQuery)
   */
  static homeOf(r: Readonly<AppRow>, site: string): string {
    return r.domain && r.domain_checked_at ? `https://${r.domain}` : `${site}/${r.slug}`;
  }

  private posts: readonly ScreenPostRow[] = [];
  private next: string | null = null;
  private article: { row: ScreenArticleRow; back: string } | null = null;
  private menu: Readonly<MenuRow> | null = null;
  private issues: readonly IssueRow[] = [];
  private issue: { row: IssueRow; posts: readonly ScreenIssuePostRow[] } | null = null;
  private pages: readonly Pick<PageRow, 'name' | 'title' | 'updated_at'>[] = [];
  private view: string | null = null;

  constructor(
    /** home · post · menu · issue · missing (AppScreenQuery가 정한다) */
    readonly screen: string,
    private readonly app: Readonly<AppRow>,
    /** 이 화면의 앱 주소 앞부분 (/<앱> 또는 미리 보기 /<앱>/~<토큰>, 앱 도메인이면 "" 또는 /~<토큰>). 끝에 / 없이 */
    private readonly base: string,
    /** 공개 앱 (순서대로) */
    private readonly apps: readonly AppRow[],
    private readonly menus: readonly MenuRow[],
    /** 공개 앱에 공개 글이 있는가 (그래프 링크) */
    private readonly graph: boolean,
    /**
     * 앱 도메인으로 연 화면이면 기본 도메인의 출처 (https://<사이트>, 사이트 주소를 정하기 전이면 ""),
     * 기본 도메인으로 연 화면이면 null (스토어 3-0)
     */
    private readonly site: string | null = null,
  ) {}

  /** 글 목록 한 쪽. next가 있으면 ?cursor=next로 다음 쪽 */
  withPosts(rows: readonly ScreenPostRow[], next: string | null): this {
    this.posts = rows;
    this.next = next;
    return this;
  }

  withArticle(row: ScreenArticleRow): this {
    const back = row.menu_slug === null ? this.home() : this.menuUrl(row.menu_slug);
    this.article = { row, back };
    return this;
  }

  withMenu(row: Readonly<MenuRow>): this {
    this.menu = row;
    return this;
  }

  withIssues(rows: readonly IssueRow[]): this {
    this.issues = rows;
    return this;
  }

  withIssue(row: IssueRow, posts: readonly ScreenIssuePostRow[]): this {
    this.issue = { row, posts };
    return this;
  }

  withPages(rows: readonly Pick<PageRow, 'name' | 'title' | 'updated_at'>[]): this {
    this.pages = rows;
    return this;
  }

  /** 페이지 앱의 다른 화면 이름 (/<앱>/<이름> → <이름>.html, 페이지 앱 P1) */
  withView(name: string): this {
    this.view = name;
    return this;
  }

  toJSON() {
    const app = this.app;
    const here = this.menu?.slug ?? null;
    const apps = this.apps.map((r) => ({
      name: r.name,
      url: this.appUrl(r),
      iconUrl: iconOf(r),
      current: r.id === app.id,
    }));
    return {
      cairn: 1,
      screen: this.screen,
      isHome: this.screen === 'home',
      isPost: this.screen === 'post',
      isMenu: this.screen === 'menu',
      isIssue: this.screen === 'issue',
      isTopic: this.screen === 'topic',
      isView: this.screen === 'view',
      view: this.view,
      title: this.title(),
      base: this.home(),
      files: `${this.base}/files`,
      site: {
        home: `${this.origin()}/`,
        /** 스토어 첫 화면 (2026-11-26): 첫 화면이 앱 하나로 고정돼도 늘 앱 목록. "모든 앱" 링크가 쓴다 */
        store: `${this.origin()}/store`,
        loginUrl: `${this.origin()}/login`,
        graphUrl: this.graph ? `${this.origin()}/graph` : null,
      },
      app: {
        name: app.name,
        description: app.description,
        kind: app.kind,
        url: this.appUrl(app),
        iconUrl: iconOf(app),
        rssUrl:
          app.kind === 'page' || app.kind === 'community' ? null : `${this.feedBase()}/rss.xml`,
      },
      apps,
      others: apps.filter((a) => !a.current),
      menus: this.menus.map((m) => ({
        name: m.name,
        url: this.menuUrl(m.slug),
        kind: m.kind,
        active: m.slug === here,
      })),
      menu: this.menuJson(),
      posts: this.posts.map((p) => this.postLine(p)),
      more: this.next === null ? null : { url: `${this.here()}?cursor=${enc(this.next)}` },
      post: this.articleJson(),
      issues: this.issues.map((i) => this.issueLine(i)),
      issue: this.issueJson(),
      pages: this.pages.map((p) => ({
        title: p.title,
        url: `${this.origin()}/pages/${enc(p.name)}/`,
        date: p.updated_at.toISOString(),
      })),
    };
  }

  private title(): string {
    const app = this.app.name;
    if (this.article) return `${this.article.row.title ?? ''} · ${app}`;
    if (this.issue) return `${this.issue.row.number}호 · ${this.issue.row.title} · ${app}`;
    if (this.screen === 'menu' && this.menu) return `${this.menu.name} · ${app}`;
    return app;
  }

  private here(): string {
    return this.screen === 'menu' && this.menu ? this.menuUrl(this.menu.slug) : this.home();
  }

  /** 이 앱의 첫 화면 (앱 도메인의 뿌리면 /) */
  private home(): string {
    return this.base || '/';
  }

  /** 앱 목록의 주소: 이 앱은 이 화면의 앱 주소, 다른 앱은 그 앱의 바깥 주소 */
  private appUrl(r: Readonly<AppRow>): string {
    if (r.id === this.app.id) return this.home();
    const home = AppScreenDataView.homeOf(r, this.origin());
    return r.domain && r.domain_checked_at ? `${home}/` : home;
  }

  /** 기본 도메인에 있는 것의 앞부분: 기본 도메인으로 연 화면이면 "" (같은 출처) */
  private origin(): string {
    return this.site ?? '';
  }

  /** RSS의 앞부분: 미리 보기 토큰 없이 (RSS는 공개 앱만, 웹이 그린다). 앱 도메인이면 그 뿌리 */
  private feedBase(): string {
    return this.site === null ? `/${this.app.slug}` : '';
  }

  private menuUrl(slug: string): string {
    return `${this.base}/m/${enc(slug)}`;
  }

  private postLine(p: ScreenPostRow) {
    return {
      title: p.title ?? '',
      excerpt: p.excerpt ?? '',
      url: `${this.base}/posts/${enc(p.slug)}`,
      date: p.published_at?.toISOString() ?? null,
      tags: [...p.tags],
    };
  }

  private menuJson() {
    const m = this.menu;
    if (!m) return null;
    return {
      name: m.name,
      url: this.menuUrl(m.slug),
      kind: m.kind,
      isPosts: m.kind === 'posts',
      isIssues: m.kind === 'issues',
      isPages: m.kind === 'pages',
      isPage: m.kind === 'page',
      rssUrl: m.kind === 'posts' && m.rss ? `${this.feedBase()}/m/${enc(m.slug)}/rss.xml` : null,
    };
  }

  private articleJson() {
    if (!this.article) return null;
    const { row, back } = this.article;
    return {
      ...this.postLine(row),
      body: row.body ?? '',
      center: row.align === 'center',
      /** 목록에 보이는 글인가 (링크 공개 글은 아니다: 검색 엔진에 알리지 않게 noindex) */
      listed: row.status === 'published',
      back,
    };
  }

  private issueLine(i: IssueRow) {
    const menu = this.menu?.slug ?? '';
    return {
      number: i.number,
      title: i.title,
      intro: i.intro ?? '',
      url: `${this.menuUrl(menu)}/${i.number}`,
      date: i.published_at?.toISOString() ?? null,
    };
  }

  private issueJson() {
    if (!this.issue) return null;
    const { row, posts } = this.issue;
    return {
      ...this.issueLine(row),
      posts: posts.map((p) => ({
        title: p.title ?? '',
        excerpt: p.excerpt ?? '',
        url: `${this.base}/posts/${enc(p.slug)}`,
      })),
    };
  }
}

/**
 * 화면을 어떻게 여는가 (스토어 12.2). open: 그 앱의 확인한 도메인으로 연 공개 화면이라 격리(sandbox)를 풀어도 된다
 * (콘솔과 다른 출처다). 기본 도메인의 /<앱>과 미리 보기는 거짓. permissions: 선언서가 바라는 브라우저 권한 (open일 때만 열린다)
 */
export interface AppScreenAccess {
  open: boolean;
  permissions: readonly string[];
  /** 관리자가 연 화면이면 콘솔의 이 앱 관리 주소 (웹이 화면에 "콘솔로" 링크를 붙인다), 방문자면 null */
  console: string | null;
}

/** 화면 하나: 템플릿(.html 전부) · 고른 템플릿 · 바깥 주소 · 데이터. 앱 안의 없는 주소는 status 404 */
export class AppScreenView {
  constructor(
    private readonly status: number,
    /** 그린 코드의 버전. 0이면 종류의 시작 코드 */
    private readonly seq: number,
    /** 채울 템플릿. 없으면(앱 안의 없는 주소인데 404.html이 없다) 웹이 Cairn의 404를 그린다 */
    private readonly template: string | null,
    private readonly templates: ReadonlyMap<string, string>,
    private readonly hosts: readonly string[],
    private readonly data: AppScreenDataView,
    /** 격리를 푼 화면인가 · 그때 여는 브라우저 권한 (스토어 12.2) */
    private readonly access: AppScreenAccess,
  ) {}

  toJSON() {
    return {
      status: this.status,
      seq: this.seq,
      template: this.template,
      templates: Object.fromEntries(this.templates),
      hosts: [...this.hosts],
      open: this.access.open,
      permissions: [...this.access.permissions],
      console: this.access.console,
      data: this.data.toJSON(),
      redirect: null,
      page: null,
    };
  }
}

/**
 * 정적 앱의 화면 (스토어 9.13, cairn.json의 "render": "static"): 템플릿을 채우지 않고 묶음의 파일을 그대로 내보낸다.
 * file은 이 주소가 가리키는 파일 (없는 주소 중 확장자가 없는 것은 index.html: 앱 안의 화면 전환), 없는 파일이면 null(404).
 * HTML이면 글(text)을 함께 준다: 웹이 주소 기준(<base>)과 데이터 블록을 넣어 격리 머리글과 함께 보낸다.
 * 그 밖의 파일은 웹이 파일 주소(files/<경로>)에서 받아 넘긴다
 */
export class AppScreenStaticView {
  constructor(
    private readonly seq: number,
    private readonly file: string | null,
    private readonly text: string | null,
    private readonly hosts: readonly string[],
    /** HTML로 나가는 화면에만 싣는다 (그 밖의 파일은 웹이 파일 주소에서 받아 넘길 뿐이다) */
    private readonly data: AppScreenDataView | null,
    private readonly access: AppScreenAccess,
  ) {}

  toJSON() {
    return {
      status: this.file === null ? 404 : 200,
      seq: this.seq,
      static: { file: this.file, text: this.text },
      hosts: [...this.hosts],
      open: this.access.open,
      permissions: [...this.access.permissions],
      console: this.access.console,
      data: this.data === null ? null : this.data.toJSON(),
      redirect: null,
      page: null,
    };
  }
}

/**
 * 화면이 페이지다 (페이지 앱 P1 ④, 2026-11-20): 앱 코드를 만든 적이 없는 페이지 앱에 공개 페이지가 있으면 그 페이지가 앱의 화면이다.
 * 웹이 첫 화면을 <base>/index.html로 보내(페이지 안의 상대 주소가 앱 주소 아래로 풀리게) 페이지의 파일을 앱 주소 아래로 내보낸다
 */
export class AppScreenPageView {
  constructor(
    private readonly name: string,
    /** 연 파일 (/<앱>/<파일>). 첫 화면이면 null */
    private readonly file: string | null,
    /** 이 앱의 주소 앞부분 (/<앱>, 앱 도메인이면 ""). 끝에 / 없이 */
    private readonly base: string,
  ) {}

  toJSON() {
    return { redirect: null, page: { name: this.name, file: this.file, base: this.base } };
  }
}

/**
 * 다른 주소로 보내기: 다른 앱에 든 글, 관리자가 토큰 없이 연 비공개 앱(토큰 주소),
 * 연결을 확인한 도메인이 있는 앱을 기본 도메인으로 연 화면(그 도메인으로, permanent: 스토어 3-0)
 */
export class AppScreenRedirectView {
  constructor(
    readonly url: string,
    /** 늘 그 주소로 가는가 (웹이 308로 보낸다). 아니면 307 */
    private readonly permanent = false,
  ) {}

  toJSON() {
    return { redirect: this.url, permanent: this.permanent };
  }
}
