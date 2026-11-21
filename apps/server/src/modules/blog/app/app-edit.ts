import {
  Conflict,
  RuleViolation,
  type SettingChangeInput,
  type SettingShape,
  type Sql,
} from '../../platform';
import { Menu } from '../menu/menu';
import { MenuRepository } from '../menu/menu.repository';
import type { Page } from '../page/page';
import { PageRepository } from '../page/page.repository';
import { App } from './app';
import { CreateAppInput, UpdateAppInput } from './app.input';
import { AppRepository } from './app.repository';

/**
 * 앱 만들기 · 고치기 한 번을 부르는 쪽의 트랜잭션에서 (MenuEdit과 같은 모양).
 * 관리자의 만들기 · 고치기(AppService), 설정 바꾸기 제안의 미리 해 보기, 승인 뒤 적용이 같은 줄을 지난다.
 * 만들기는 시작 메뉴와 페이지 앱의 페이지까지 한 번에 준비하고, 저장은 save가 한다 (미리 해 보기는 부르지 않는다).
 * 앱과 메뉴 · 페이지를 한 번에 만드는 이 줄만 메뉴 · 페이지의 Repository를 함께 쓴다 (IssueService와 같은 예외)
 */
export class AppEdit {
  /**
   * 대화로 바꾸는 앱 (get_settings apps · propose_setting app). 종류 · 시작 메뉴는 만들 때만, 공개 여부 · 첫 화면 고정은 없다.
   * 편집 방침은 스토어 2단계. 앱의 운영 팀(운영 팀장 · new_team)은 없앴다 (2026-11-21 팀 없는 에이전트: 대표가 누구에게나 맡긴다)
   */
  static readonly SETTING: SettingShape = {
    setting: 'app',
    list: 'apps',
    ops: ['create', 'edit'],
    fields: ['name', 'slug', 'kind', 'description', 'sort', 'menus', 'policy'],
    target: 'id',
    versioned: true,
    grants: [],
  };
  /** 종류마다 시작 메뉴 (menus를 보내지 않았을 때): 블로그는 글 목록, 매거진은 호 목록 */
  private static readonly BLOG_STARTER = ['글', 'posts', Menu.POSTS] as const;
  private static readonly MAGAZINE_STARTER = ['호', 'issues', Menu.ISSUES] as const;

  private readonly apps: AppRepository;
  private app: App | null = null;
  private menus: Menu[] = [];
  private page: Page | null = null;

  constructor(
    private readonly tx: Sql,
    private readonly spaceId: string,
  ) {
    this.apps = new AppRepository(tx);
  }

  /** 새 앱(비공개)과 시작 메뉴, 페이지 앱의 페이지 (아직 저장 전) */
  async create(req: CreateAppInput, now: Date): Promise<App> {
    const app = App.open(this.spaceId, req.kind, req.fields, now);
    await this.assertFree(app.slug, null);
    if (app.kind === App.PAGE) {
      if (req.menus !== null) throw new RuleViolation('페이지 앱에는 메뉴를 둘 수 없어요');
      // 페이지 없이도 만든다: 화면은 앱 코드다 (스토어 2-6). 주면 그 페이지를 앱에 넣는다
      if (req.pageId !== null) {
        this.page = await new PageRepository(this.tx).lockForApp(this.spaceId, req.pageId);
        this.page.moveToApp(app.id, now);
      }
    } else if (req.pageId !== null) {
      throw new RuleViolation('페이지는 페이지 앱에만 넣어요');
    }
    this.menus = this.starters(app, req.menus, now);
    this.app = app;
    return app;
  }

  /** siteHost: 기본 도메인의 호스트 (도메인을 바꿀 때만 쓴다, 스토어 3-0) */
  async update(req: UpdateAppInput, now: Date, siteHost: string | null = null): Promise<App> {
    const app = await this.apps.lock(this.spaceId, req.id);
    app.assertVersion(req.version);
    app.edit(req.changes, now);
    await this.assertFree(app.slug, app.id);
    if (req.domain !== undefined) {
      app.setDomain(req.domain, siteHost, now);
      if (app.domain !== null && (await this.apps.domainTaken(app.domain, app.id)))
        throw new Conflict('다른 앱이 쓰는 도메인이에요');
    }
    this.app = app;
    return app;
  }

  /** 설정 바꾸기 하나: body는 get_settings와 같은 칸, key는 만들기의 requestId */
  apply(change: SettingChangeInput, now: Date): Promise<App> {
    const { kind, menus, ...fields } = change.body;
    if ('visibility' in fields || 'home' in fields || 'domain' in fields)
      throw new RuleViolation('공개 여부 · 첫 화면 · 도메인은 관리자가 앱 관리에서 바꿔요');
    if (change.op === 'create')
      return this.create(
        CreateAppInput.from({ ...fields, kind, menus, requestId: change.key }),
        now,
      );
    if (kind !== undefined || menus !== undefined)
      throw new RuleViolation('앱의 종류 · 시작 메뉴는 만들 때만 정해요');
    return this.update(
      UpdateAppInput.from(String(change.targetId), { ...fields, version: change.version }),
      now,
    );
  }

  /** 준비한 앱과 시작 메뉴 · 페이지를 저장한다 (앱이 먼저: 메뉴 · 페이지가 앱을 가리킨다) */
  async save(): Promise<void> {
    if (!this.app) throw new Error('저장할 앱이 없어요');
    await this.apps.save(this.app);
    const menus = new MenuRepository(this.tx);
    for (const menu of this.menus) await menus.save(menu);
    if (this.page) await new PageRepository(this.tx).save(this.page);
  }

  /** 다른 앱이 쓰는 주소면 409 (저장 때의 UNIQUE와 같은 판단을 미리 해 보기에서도 하려고) */
  private async assertFree(slug: string, exceptId: string | null): Promise<void> {
    if (await this.apps.slugTaken(this.spaceId, slug, exceptId))
      throw new Conflict('이미 쓰는 앱 주소예요');
  }

  /** 시작 메뉴: 이름을 주면 그 이름들의 글 목록 메뉴, 아니면 종류의 기본. 페이지 앱 · 커뮤니티 앱은 없다 */
  private starters(app: App, names: readonly string[] | null, now: Date): Menu[] {
    if (app.kind === App.PAGE) return [];
    if (app.kind === App.COMMUNITY) {
      if (names !== null) app.assertHoldsMenus();
      return [];
    }
    if (names === null) {
      const [name, slug, kind] =
        app.kind === 'magazine' ? AppEdit.MAGAZINE_STARTER : AppEdit.BLOG_STARTER;
      return [Menu.open(this.spaceId, app.id, kind, { name, slug }, now)];
    }
    return names.map((name, sort) =>
      Menu.open(this.spaceId, app.id, Menu.POSTS, { name, sort }, now),
    );
  }
}
