import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, Database, HostGate, NotFound, SecretBox } from '../../platform';
import { App } from '../app/app';
import { apps, pages } from '../blog.schema';
import type { AppRow } from '../blog.tables';
import { Page } from '../page/page';
import { PageFiles } from '../page/page-files';
import type { AppFileInput, AppScreenInput } from './app-code.input';
import { AppCodeQuery } from './app-code.query';
import { AppCodeBundle } from './app-code-bundle';
import type { AppCodeFiles } from './app-code-files';
import { AppScreenQuery } from './app-screen.query';
import { AppScreenPageView, AppScreenRedirectView, AppScreenView } from './app-screen.view';
import { AppTicket } from './app-ticket';

/** 앱 코드의 파일 하나 (웹의 /<앱>/files/<이름>) */
export class AppFileAnswer {
  constructor(
    readonly stream: Readable,
    readonly type: string,
    readonly size: number,
    readonly cacheControl: string,
  ) {}
}

// 방문자가 보는 앱 화면 (스토어 1-6, docs/스토어.md 9.4 · 9.5). 웹의 /<앱>/… 이 화면 하나에 필요한 것(템플릿 · 바깥 주소 · 데이터)을,
// /<앱>/files/<이름>이 파일 하나를 여기서 받는다. 그리기(Mustache)와 격리 머리글은 웹이 한다.
// 볼 수 있는 앱 = 공개 앱 (방문자 · 관리자 모두 같은 화면), 또는 미리 보기 토큰의 그 앱 하나 (비공개여도 공개된 것처럼).
// 없는 앱 · 비공개 앱 · 틀린 토큰은 모두 같은 404다: 앱이 있다는 사실도 드러나지 않는다 (원칙 5).
// 앱마다 도메인 (스토어 3-0): 웹이 방문자가 연 호스트(host)를 함께 넘긴다. 그 앱의 도메인이면 도메인의 뿌리가 앱 주소이고
// 기본 도메인에 있는 것은 사이트 주소로 적는다 (AppScreenDataView). 다른 호스트(기본 도메인)인데 연결을 확인한 도메인이 있으면
// 그 도메인의 같은 경로로 보낸다 (308). 미리 보기 토큰은 보내지 않는다 (토큰은 기본 도메인의 관리자 화면에서 연다).
@Injectable()
export class AppSiteQuery extends BaseQuery {
  private static readonly MISSING = '없는 앱이에요';
  /** 화면 → 템플릿. 없으면 index.html (앱 안의 없는 주소만 404.html이고, 없으면 Cairn의 404) */
  private static readonly TEMPLATES: Readonly<Record<string, string>> = {
    [AppScreenQuery.POST]: 'post.html',
    [AppScreenQuery.MENU]: 'list.html',
    [AppScreenQuery.ISSUE]: 'issue.html',
    [AppScreenQuery.TOPIC]: 'topic.html',
  };
  private static readonly NOT_FOUND = '404.html';

  constructor(
    db: Database,
    private readonly box: SecretBox,
    private readonly code: AppCodeQuery,
    private readonly screens: AppScreenQuery,
    private readonly gate: HostGate,
  ) {
    super(db);
  }

  /**
   * 화면 하나. 관리자가 토큰 없이 비공개 앱에 오면 토큰 주소로 보낸다 (격리된 화면에는 쿠키가 실리지 않는다).
   * 다른 공개 앱에 든 글이면 그 앱의 글 주소로 보낸다
   */
  async screen(
    actor: Actor,
    req: AppScreenInput,
    now: Date,
  ): Promise<AppScreenView | AppScreenRedirectView | AppScreenPageView> {
    const found = await this.visible(actor, req.slug, req.ticket, now);
    if (found instanceof AppScreenRedirectView) {
      const rest = req.path.map(encodeURIComponent).join('/');
      return new AppScreenRedirectView(rest === '' ? found.url : `${found.url}/${rest}`);
    }
    const { app, ticket } = found;
    const own = req.host !== null && req.host === app.domain;
    if (ticket === null && !own && req.host !== null && app.domain && app.domain_checked_at)
      return AppSiteQuery.toDomain(app.domain, req);
    const root = own ? '' : `/${app.slug}`;
    const base = ticket === null ? root : `${root}/${AppTicket.MARK}${req.ticket}`;
    // 페이지 앱 P1 ④: 앱 코드를 만든 적이 없는 페이지 앱은 공개 페이지가 있으면 그 페이지가 화면이다 (파일은 한 칸짜리 주소)
    if (ticket === null && app.kind === App.PAGE && app.code_seq === null && req.path.length <= 1) {
      const page = await this.shownPage(app.id);
      if (page !== null) return new AppScreenPageView(page, req.path[0] ?? null, root);
    }
    const site = own ? ((await this.gate.siteOrigin()) ?? '') : null;
    const data = await this.screens.screen(actor, app, base, site, req.path, req.cursor);
    if (data instanceof AppScreenRedirectView) return data;
    const code = await this.code.filesOf(actor, app, ticket?.seq ?? null);
    const templates = await this.templatesOf(actor, code);
    // 페이지 앱의 다른 화면은 그 이름의 템플릿이고, 없으면 앱 안의 없는 주소다
    const view = data.screen === AppScreenQuery.VIEW ? `${req.path[0]}.html` : null;
    const missing =
      data.screen === AppScreenQuery.MISSING || (view !== null && !templates.has(view));
    const wanted = missing
      ? AppSiteQuery.NOT_FOUND
      : (view ?? AppSiteQuery.TEMPLATES[data.screen] ?? PageFiles.ENTRY);
    const template = templates.has(wanted) ? wanted : missing ? null : PageFiles.ENTRY;
    return new AppScreenView(
      missing ? 404 : 200,
      code.seq,
      template,
      templates,
      await this.code.hostsOf(actor, code),
      data,
    );
  }

  /** 페이지 앱의 화면이 될 페이지: 그 앱에 든 공개 페이지 중 판이 있는 첫 것 (만든 순서) */
  private async shownPage(appId: string): Promise<string | null> {
    const rows = await this.rows(
      pages,
      { app_id: appId, visibility: Page.PUBLIC },
      { order: ['created_at', 'id'], columns: ['name', 'current_seq'] },
    );
    return rows.find((p) => p.current_seq > 0)?.name ?? null;
  }

  /** 연결을 확인한 도메인의 같은 경로 (· 다음 쪽 커서) */
  private static toDomain(domain: string, req: AppScreenInput): AppScreenRedirectView {
    const rest = req.path.map(encodeURIComponent).join('/');
    const more = req.cursor === null ? '' : `?cursor=${encodeURIComponent(req.cursor)}`;
    return new AppScreenRedirectView(`https://${domain}/${rest}${more}`, true);
  }

  /** 파일 하나 (템플릿은 내보내지 않는다: 채우지 않은 템플릿이 그대로 보이지 않게) */
  async file(actor: Actor, req: AppFileInput, now: Date): Promise<AppFileAnswer> {
    const found = await this.visible(actor, req.slug, req.ticket, now);
    if (found instanceof AppScreenRedirectView || req.isTemplate)
      throw new NotFound('없는 파일이에요');
    const { app, ticket } = found;
    const code = await this.code.filesOf(actor, app, ticket?.seq ?? null);
    const file = code.files.find(req.name);
    if (!file) throw new NotFound('없는 파일이에요');
    return new AppFileAnswer(
      await this.code.open(actor, code, req.name),
      PageFiles.typeOf(req.name),
      file.sizeBytes,
      // 보이는 버전이 바뀌면 곧 반영되게 짧게. 미리 보기는 어디에도 남기지 않는다
      ticket === null ? 'public, max-age=60' : 'private, no-store',
    );
  }

  /** 볼 수 있는 앱과 토큰. 관리자가 토큰 없이 연 비공개 앱은 토큰 주소로 보낸다 */
  private async visible(
    actor: Actor,
    slug: string,
    token: string | null,
    now: Date,
  ): Promise<{ app: AppRow; ticket: AppTicket | null } | AppScreenRedirectView> {
    const ticket = token === null ? null : AppTicket.open(this.box, token, now);
    // 방문자는 공간을 모른다: MVP는 공간 하나라 주소로만 찾는다 (blog 규칙)
    const [app] = await this.rows(apps, ticket === null ? { slug } : { slug, id: ticket.appId });
    if (!app) throw new NotFound(AppSiteQuery.MISSING);
    if (ticket !== null) {
      if (ticket.seq !== null && ticket.seq > app.code_versions)
        throw new NotFound(AppSiteQuery.MISSING);
      return { app, ticket };
    }
    if (app.visibility === App.PUBLIC) return { app, ticket: null };
    if (actor.kind !== 'owner' || actor.spaceId !== app.space_id)
      throw new NotFound(AppSiteQuery.MISSING);
    const sealed = new AppTicket(app.id).seal(this.box, now);
    return new AppScreenRedirectView(`/${app.slug}/${AppTicket.MARK}${sealed}`);
  }

  /** 템플릿(.html) 전부: 이름 → 글. 저장할 때 크기를 검사했다 */
  private async templatesOf(actor: Actor, code: AppCodeFiles): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    for (const f of code.files.toJSON()) {
      if (!AppCodeBundle.isTemplate(f.name)) continue;
      const text = await this.code.textOf(actor, code, f.name, AppCodeBundle.TEMPLATE_BYTES_MAX);
      if (text !== null) found.set(f.name, text);
    }
    return found;
  }
}
