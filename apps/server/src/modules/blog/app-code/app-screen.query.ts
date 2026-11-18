import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery } from '../../platform';
import { App } from '../app/app';
import { apps, issues, menus } from '../blog.schema';
import type { AppRow, IssueRow, MenuRow, PageRow } from '../blog.tables';
import { ListPostsInput } from '../post/post.input';
import {
  AppScreenDataView,
  AppScreenRedirectView,
  type ScreenArticleRow,
  type ScreenIssuePostRow,
  type ScreenPostRow,
} from './app-screen.view';

// 앱 화면 하나의 데이터 (스토어 1-6, 데이터 약속 cairn: 1). 앱은 AppSiteQuery가 이미 정했다: 방문자에게는 공개 앱,
// 미리 보기 토큰에는 그 앱 하나(비공개여도 공개된 것처럼). 그래서 여기서는 앱 공개 여부를 다시 보지 않고 그 앱 안의
// 방문자에게 보이는 것만 읽는다: 공개 글(목록) · 공개와 링크 공개 글(주소로) · 발행한 호 · 공개 페이지. 초안은 미리 보기에도 없다.
@Injectable()
export class AppScreenQuery extends BaseQuery {
  static readonly HOME = 'home';
  static readonly POST = 'post';
  static readonly MENU = 'menu';
  static readonly ISSUE = 'issue';
  static readonly MISSING = 'missing';
  private static readonly PAGE = 20;
  private static readonly NUMBER = /^[1-9]\d{0,8}$/;

  /**
   * 앱 안 경로의 화면: '' 첫 화면, posts/<글>, m/<메뉴>, m/<메뉴>/<번호>. 그 밖은 missing.
   * 다른 공개 앱에 든 글이면 그 앱의 주소로 보낸다 (글은 앱을 옮길 수 있다)
   */
  async screen(
    actor: Actor,
    app: Readonly<AppRow>,
    base: string,
    path: readonly string[],
    cursor: string | null,
  ): Promise<AppScreenDataView | AppScreenRedirectView> {
    const [first, second, third, ...rest] = path;
    if (rest.length > 0) return this.frame(actor, AppScreenQuery.MISSING, app, base);
    if (first === undefined) return this.home(actor, app, base, cursor);
    if (first === 'posts' && second !== undefined && third === undefined)
      return this.post(actor, app, base, second);
    if (first === 'm' && second !== undefined) {
      const menu = (await this.rows(menus, { app_id: app.id, slug: second }))[0] ?? null;
      if (menu === null) return this.frame(actor, AppScreenQuery.MISSING, app, base);
      if (third === undefined) return this.menu(actor, app, base, menu, cursor);
      if (menu.kind === 'issues' && AppScreenQuery.NUMBER.test(third))
        return this.issue(actor, app, base, menu, Number(third));
    }
    return this.frame(actor, AppScreenQuery.MISSING, app, base);
  }

  /** 첫 화면: 블로그는 글 목록, 매거진은 첫 호 메뉴의 최신 호, 페이지 앱은 공개 페이지 */
  private async home(actor: Actor, app: Readonly<AppRow>, base: string, cursor: string | null) {
    const view = await this.frame(actor, AppScreenQuery.HOME, app, base);
    if (app.kind === App.PAGE) return view.withPages(await this.pagesOf(app.id, null));
    if (app.kind === 'magazine') {
      const [menu] = await this.rows(
        menus,
        { app_id: app.id, kind: 'issues' },
        { order: ['sort', 'created_at', 'id'] },
      );
      if (!menu) return view;
      const list = await this.publishedIssues(menu.id);
      const [latest] = list;
      view.withMenu(menu).withIssues(list);
      return latest ? view.withIssue(latest, await this.issuePosts(latest.id)) : view;
    }
    const [rows, next] = await this.postsOf(app.id, null, cursor);
    return view.withPosts(rows, next);
  }

  private async post(actor: Actor, app: Readonly<AppRow>, base: string, slug: string) {
    const [row] = await this.sql<(ScreenArticleRow & { app_id: string | null })[]>`
      SELECT p.slug, p.title, p.excerpt, p.tags, p.published_at, p.align, p.status, p.app_id,
             r.body_md AS body, m.slug AS menu_slug
      FROM blog.posts p LEFT JOIN blog.post_revisions r ON r.id = p.head_revision_id
        LEFT JOIN blog.menus m ON m.id = p.menu_id
      WHERE p.space_id = ${app.space_id} AND p.slug = ${slug} AND p.deleted_at IS NULL
        AND p.status IN ('published', 'unlisted')`;
    if (!row) return this.frame(actor, AppScreenQuery.MISSING, app, base);
    if (row.app_id !== app.id) {
      // 다른 공개 앱에 든 글: 그 앱의 주소로. 비공개 앱 · 앱 밖의 글은 없는 글과 같다
      const [other] =
        row.app_id === null
          ? []
          : await this.rows(apps, { id: row.app_id, visibility: App.PUBLIC });
      if (!other) return this.frame(actor, AppScreenQuery.MISSING, app, base);
      return new AppScreenRedirectView(`/${other.slug}/posts/${encodeURIComponent(row.slug)}`);
    }
    const view = await this.frame(actor, AppScreenQuery.POST, app, base);
    return view.withArticle(row);
  }

  private async menu(
    actor: Actor,
    app: Readonly<AppRow>,
    base: string,
    menu: Readonly<MenuRow>,
    cursor: string | null,
  ) {
    const view = (await this.frame(actor, AppScreenQuery.MENU, app, base)).withMenu(menu);
    if (menu.kind === 'issues') return view.withIssues(await this.publishedIssues(menu.id));
    if (menu.kind === 'pages' || menu.kind === 'page')
      return view.withPages(await this.pagesOf(app.id, menu.id));
    const [rows, next] = await this.postsOf(app.id, menu.id, cursor);
    return view.withPosts(rows, next);
  }

  private async issue(
    actor: Actor,
    app: Readonly<AppRow>,
    base: string,
    menu: Readonly<MenuRow>,
    number: number,
  ) {
    const [row] = await this.rows(issues, { menu_id: menu.id, number, status: 'published' });
    if (!row) return this.frame(actor, AppScreenQuery.MISSING, app, base);
    const view = await this.frame(actor, AppScreenQuery.ISSUE, app, base);
    return view.withMenu(menu).withIssue(row, await this.issuePosts(row.id));
  }

  /** 모든 화면에 드는 것: 공개 앱 목록 · 이 앱의 메뉴 · 그래프 링크 */
  private async frame(
    _actor: Actor,
    screen: string,
    app: Readonly<AppRow>,
    base: string,
  ): Promise<AppScreenDataView> {
    const [shown, list, [graph]] = await Promise.all([
      this.rows(
        apps,
        { space_id: app.space_id, visibility: App.PUBLIC },
        { order: ['sort', 'created_at', 'id'] },
      ),
      this.rows(menus, { app_id: app.id }, { order: ['sort', 'created_at', 'id'] }),
      this.sql<{ open: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM blog.posts p JOIN blog.apps a ON a.id = p.app_id
          WHERE p.space_id = ${app.space_id} AND p.status = 'published' AND p.deleted_at IS NULL
            AND a.visibility = ${App.PUBLIC}
        ) AS open`,
    ]);
    return new AppScreenDataView(screen, app, base, shown, list, graph?.open === true);
  }

  /** 앱(과 메뉴)의 공개 글 한 쪽, 발행한 순서. 다음 쪽이 있으면 그 커서 */
  private async postsOf(
    appId: string,
    menuId: string | null,
    cursor: string | null,
  ): Promise<[ScreenPostRow[], string | null]> {
    const before = cursor === null ? null : ListPostsInput.from({ cursor }).before;
    const rows = await this.sql<(ScreenPostRow & { id: string })[]>`
      SELECT p.id, p.slug, p.title, p.excerpt, p.tags, p.published_at FROM blog.posts p
      WHERE p.app_id = ${appId} AND p.status = 'published' AND p.deleted_at IS NULL
        ${menuId === null ? this.sql`` : this.sql`AND p.menu_id = ${menuId}`}
        ${before === null ? this.sql`` : this.sql`AND (p.published_at, p.id) < (${before[0]}, ${before[1]})`}
      ORDER BY p.published_at DESC, p.id DESC
      LIMIT ${AppScreenQuery.PAGE + 1}`;
    const { items, next } = this.pageOf(rows, AppScreenQuery.PAGE, (last) =>
      last.published_at ? ListPostsInput.cursorAfter(last.published_at, last.id) : null,
    );
    return [items, next];
  }

  private publishedIssues(menuId: string): Promise<IssueRow[]> {
    return this.rows(issues, { menu_id: menuId, status: 'published' }, { order: ['number desc'] });
  }

  /** 호에 든 공개 글, 호 안의 순서대로 */
  private issuePosts(issueId: string): Promise<ScreenIssuePostRow[]> {
    return this.sql<ScreenIssuePostRow[]>`
      SELECT slug, title, excerpt FROM blog.posts
      WHERE issue_id = ${issueId} AND deleted_at IS NULL AND status = 'published'
      ORDER BY issue_order, id`;
  }

  /** 앱(메뉴를 주면 그 메뉴)의 공개 페이지, 고친 순서 */
  private pagesOf(
    appId: string,
    menuId: string | null,
  ): Promise<Pick<PageRow, 'name' | 'title' | 'updated_at'>[]> {
    return this.sql<Pick<PageRow, 'name' | 'title' | 'updated_at'>[]>`
      SELECT name, title, updated_at FROM blog.pages
      WHERE app_id = ${appId} AND visibility = 'public'
        ${menuId === null ? this.sql`` : this.sql`AND menu_id = ${menuId}`}
      ORDER BY updated_at DESC, id DESC`;
  }
}
