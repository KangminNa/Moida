import type { AppRow, IssueRow, MenuRow, PageRow, PostRow } from '../blog.tables';

// 앱 화면 하나의 데이터 (스토어 1-6, 데이터 약속 cairn: 1, docs/스토어.md 9.3). 웹이 앱 코드의 템플릿(Mustache)에 채우고,
// 같은 값을 <script id="cairn-data">로 싣는다. 약속은 이름을 더하기만 한다 (빼거나 바꾸면 cairn: 2).
// 방문자 데이터만 담는다: 누가 보든(관리자 · 미리 보기 토큰도) 같은 모양이고, 보이는지는 Query가 앱을 정할 때 이미 걸렀다.
// 웹이 더하는 것: 날짜 글자(dateText), 글 본문의 HTML(post.html), 사이트 이름(site.name).

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
  private posts: readonly ScreenPostRow[] = [];
  private next: string | null = null;
  private article: { row: ScreenArticleRow; back: string } | null = null;
  private menu: Readonly<MenuRow> | null = null;
  private issues: readonly IssueRow[] = [];
  private issue: { row: IssueRow; posts: readonly ScreenIssuePostRow[] } | null = null;
  private pages: readonly Pick<PageRow, 'name' | 'title' | 'updated_at'>[] = [];

  constructor(
    /** home · post · menu · issue · missing (AppScreenQuery가 정한다) */
    readonly screen: string,
    private readonly app: Readonly<AppRow>,
    /** 이 화면의 앱 주소 (/<앱> 또는 미리 보기 /<앱>/~<토큰>) */
    private readonly base: string,
    /** 공개 앱 (순서대로) */
    private readonly apps: readonly AppRow[],
    private readonly menus: readonly MenuRow[],
    /** 공개 앱에 공개 글이 있는가 (그래프 링크) */
    private readonly graph: boolean,
  ) {}

  /** 글 목록 한 쪽. next가 있으면 ?cursor=next로 다음 쪽 */
  withPosts(rows: readonly ScreenPostRow[], next: string | null): this {
    this.posts = rows;
    this.next = next;
    return this;
  }

  withArticle(row: ScreenArticleRow): this {
    const back = row.menu_slug === null ? `${this.base}/` : this.menuUrl(row.menu_slug);
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

  toJSON() {
    const app = this.app;
    const here = this.menu?.slug ?? null;
    const appUrl = (r: Readonly<AppRow>) => `/${r.slug}/`;
    const apps = this.apps.map((r) => ({
      name: r.name,
      url: appUrl(r),
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
      title: this.title(),
      base: this.base,
      files: `${this.base}/files`,
      site: { home: '/', loginUrl: '/login', graphUrl: this.graph ? '/graph' : null },
      app: {
        name: app.name,
        description: app.description,
        kind: app.kind,
        url: appUrl(app),
        iconUrl: iconOf(app),
        rssUrl: app.kind === 'page' ? null : `/${app.slug}/rss.xml`,
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
        url: `/pages/${enc(p.name)}/`,
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
    return this.screen === 'menu' && this.menu ? this.menuUrl(this.menu.slug) : `${this.base}/`;
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
      rssUrl: m.kind === 'posts' && m.rss ? `/${this.app.slug}/m/${enc(m.slug)}/rss.xml` : null,
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
  ) {}

  toJSON() {
    return {
      status: this.status,
      seq: this.seq,
      template: this.template,
      templates: Object.fromEntries(this.templates),
      hosts: [...this.hosts],
      data: this.data.toJSON(),
      redirect: null,
    };
  }
}

/** 다른 주소로 보내기: 다른 앱에 든 글, 관리자가 토큰 없이 연 비공개 앱(토큰 주소) */
export class AppScreenRedirectView {
  constructor(readonly url: string) {}

  toJSON() {
    return { redirect: this.url };
  }
}
