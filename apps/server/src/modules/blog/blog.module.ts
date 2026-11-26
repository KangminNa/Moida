import { Module, type OnModuleInit } from '@nestjs/common';
import {
  ActionChecks,
  BlobStore,
  CoreWorkers,
  EventCatalog,
  HostGate,
  LibraryQuery,
  LibraryTrashService,
  Lookups,
} from '../platform';
import { App } from './app/app';
import { AppController, AppDomainController } from './app/app.api';
import { AppQuery } from './app/app.query';
import { AppService } from './app/app.service';
import { AppPublishHandler } from './app/app-publish.handler';
import { AppCodeController, AppSiteController } from './app-code/app-code.api';
import { AppCodeQuery } from './app-code/app-code.query';
import { AppCodeService } from './app-code/app-code.service';
import { AppCodeBaseTool, AppCodeUploadTool } from './app-code/app-code.tool';
import { AppCodeBuiltHandler } from './app-code/app-code-built.handler';
import { AppCodeShowHandler } from './app-code/app-code-show.handler';
import { AppScreenQuery } from './app-code/app-screen.query';
import { AppSiteQuery } from './app-code/app-site.query';
import { AppStarterGateway } from './app-code/app-starter.gateway';
import { AssetController, FileController } from './asset/asset.api';
import { AssetQuery } from './asset/asset.query';
import { AssetService } from './asset/asset.service';
import { BasketController } from './basket/basket.api';
import { BasketQuery } from './basket/basket.query';
import { BasketService } from './basket/basket.service';
import { BasketGetTool, KeepPageTool } from './basket/basket.tool';
import events from './blog.events.json';
import { BlogNotices } from './blog-notices';
import { BlogSettings } from './blog-settings';
import { BlogTools } from './blog-tools';
import { Issue } from './issue/issue';
import { IssueController } from './issue/issue.api';
import { IssueQuery } from './issue/issue.query';
import { IssueService } from './issue/issue.service';
import { IssuePublishHandler } from './issue/issue-publish.handler';
import { MenuController } from './menu/menu.api';
import { MenuQuery } from './menu/menu.query';
import { MenuService } from './menu/menu.service';
import { BlogMenusTool } from './menu/menu.tool';
import { PageController } from './page/page.api';
import { PageQuery } from './page/page.query';
import { PageService } from './page/page.service';
import { PageBaseTool } from './page/page.tool';
import { PageBuiltHandler } from './page/page-built.handler';
import { PostController } from './post/post.api';
import { PostQuery } from './post/post.query';
import { PostService } from './post/post.service';
import { BlogGetPostTool, BlogSaveDraftTool } from './post/post.tool';
import { PostArchiveQuery } from './post/post-archive.query';
import { PostPublish } from './post/post-publish.policy';
import { PublishApprovedHandler } from './post/publish-approved.handler';

// 방문자가 읽는 스토어의 앱(블로그 · 매거진 · 페이지 앱)과 글을 쓰는 재료: 앱, 글(쓰기·고치기·공개 범위·휴지통), 사진, 소재, AI 도구의 초안.
// vault는 소재의 세션을 확인할 때 Query로만 읽는다. 주인이 결재한 공개는 이벤트로 받아 실행한다 (task를 부르지 않는다).
@Module({
  providers: [
    BlogNotices,
    BlogSettings,
    PostService,
    PostQuery,
    PostArchiveQuery,
    AssetService,
    AssetQuery,
    BasketService,
    BasketQuery,
    BlogGetPostTool,
    BlogSaveDraftTool,
    BasketGetTool,
    KeepPageTool,
    PageBaseTool,
    BlogTools,
    PublishApprovedHandler,
    PageService,
    PageQuery,
    PageBuiltHandler,
    // 블로그 메뉴 · 매거진 호 (2차 6단계)
    MenuService,
    MenuQuery,
    BlogMenusTool,
    IssueService,
    IssueQuery,
    IssuePublishHandler,
    // 스토어의 앱 (스토어 1단계)
    AppService,
    AppQuery,
    // 앱 코드 (스토어 1-6)
    AppCodeService,
    AppCodeQuery,
    AppSiteQuery,
    AppScreenQuery,
    AppCodeBaseTool,
    AppCodeUploadTool,
    AppCodeBuiltHandler,
    AppCodeShowHandler,
    AppPublishHandler,
    { provide: AppStarterGateway, useFactory: () => AppStarterGateway.fromEnv() },
  ],
  controllers: [
    PostController,
    AssetController,
    FileController,
    BasketController,
    PageController,
    MenuController,
    IssueController,
    AppController,
    AppDomainController,
    AppCodeController,
    AppSiteController,
  ],
  exports: [BlogTools],
})
export class BlogModule implements OnModuleInit {
  constructor(
    private readonly workers: CoreWorkers,
    private readonly approved: PublishApprovedHandler,
    private readonly blobs: BlobStore,
    private readonly assets: AssetQuery,
    private readonly basket: BasketQuery,
    private readonly built: PageBuiltHandler,
    private readonly pages: PageQuery,
    private readonly posts: PostQuery,
    private readonly library: LibraryQuery,
    private readonly libraryTrash: LibraryTrashService,
    private readonly postService: PostService,
    private readonly basketService: BasketService,
    private readonly checks: ActionChecks,
    private readonly issuePublish: IssuePublishHandler,
    private readonly issues: IssueQuery,
    private readonly apps: AppQuery,
    private readonly appCodeBuilt: AppCodeBuiltHandler,
    private readonly appCodeShow: AppCodeShowHandler,
    private readonly appPublish: AppPublishHandler,
    private readonly appCode: AppCodeQuery,
    private readonly lookups: Lookups,
    private readonly gate: HostGate,
  ) {}

  onModuleInit(): void {
    EventCatalog.define('blog', events);
    this.workers.on(PublishApprovedHandler.TOPIC, this.approved);
    this.workers.on(PublishApprovedHandler.TOPIC, this.issuePublish);
    this.workers.expect(PublishApprovedHandler.TOPIC);
    // 만들기 작업이 끝나며 알린 페이지 (task가 보낸다)
    this.workers.on(PageBuiltHandler.TOPIC, this.built);
    // 앱 코드를 고친 만들기 작업 (스토어 1-6, task가 보낸다)
    this.workers.on(AppCodeBuiltHandler.TOPIC, this.appCodeBuilt);
    this.workers.on(AppCodeShowHandler.TOPIC, this.appCodeShow);
    // 관리자가 대화에서 요청한 배포 (2026-11-24, task가 바로 승인한 결재)
    this.workers.on(AppPublishHandler.TOPIC, this.appPublish);
    // 보관함 (2차 5단계): 페이지 · 글 · 읽은 글(소재의 링크)
    this.library.register([PageQuery.LIBRARY_KIND], (a, f) => this.pages.library(a, f));
    this.library.register([PostQuery.LIBRARY_KIND], (a, f) => this.posts.library(a, f));
    this.library.register([BasketQuery.LIBRARY_KIND], (a, f) => this.basket.library(a, f));
    // 보관함의 일괄 지우기 (2026-11-23): 글은 휴지통으로, 스크랩은 하나씩 지울 때처럼 바로. 페이지는 페이지 화면에서
    this.libraryTrash.register([PostQuery.LIBRARY_KIND], (a, ids) =>
      this.postService.trashMany(a, ids),
    );
    this.libraryTrash.register([BasketQuery.LIBRARY_KIND], (a, ids) =>
      this.basketService.removeMany(a, ids),
    );
    // 앱 이름 (스토어 2단계): task가 대화의 앱을 확인한다 (관리자는 공간의 앱, 그 밖은 공개 앱)
    this.lookups.provide('app', (a, ids) => this.apps.names(a, ids));
    this.lookups.provide('app-url', (a, ids) => this.apps.urls(a, ids));
    this.lookups.provide('app-id', (a, slugs) => this.apps.idsBySlug(a, slugs));
    // 커뮤니티 앱 (스토어 3-1): community가 공개된 커뮤니티 앱인지 묻는다 (관리자는 공간의 커뮤니티 앱)
    this.lookups.provide('community-app', (a, ids) => this.apps.names(a, ids, App.COMMUNITY));
    // 회원을 받는 앱 (스토어 12.3): 커뮤니티 앱과 선언서에 members를 적은 앱. community의 회원 API가 묻는다
    this.lookups.provide('member-app', (a, ids) => this.apps.memberApps(a, ids));
    // 앱마다 도메인 (스토어 3-0): blog가 앱 도메인에서 여는 경로는 글의 사진 · 앱 아이콘 · 연결 확인 값뿐이다
    // (화면은 웹이 그리고, 웹은 서버를 기본 이름으로 부른다)
    this.gate.registerApps((a) => this.apps.hosts(a));
    this.gate.openPaths([
      /^\/api\/files\/[^/]+$/,
      /^\/api\/apps\/by-slug\/[^/]+\/icon$/,
      /^\/\.well-known\/cairn-domain$/,
    ]);
    // 결과 카드 전에 발행의 빠진 점 (2차 6단계): 메뉴에 올리지 않은 글
    this.checks.register(PostPublish.ACTION, (a, id) => this.posts.publishProblem(a, id));
    this.checks.register(Issue.ACTION, (a, id) => this.issues.publishProblem(a, id));
    this.checks.register(App.PUBLISH_ACTION, (a, id) => this.apps.publishProblem(a, id));
    // 파일을 가리키는 칸: 쓰는 동안 platform이 파일을 지우지 않게
    this.blobs.registerUse(
      ['blog.assets.blob_hash', 'blog.posts.cover_blob_hash'],
      (actor, hashes) => this.assets.usedBlobs(actor, hashes),
    );
    this.blobs.registerUse(['work.basket_items.blob_hash'], (actor, hashes) =>
      this.basket.usedBlobs(actor, hashes),
    );
    this.blobs.registerUse(['blog.apps.icon_blob_hash'], (actor, hashes) =>
      this.apps.usedBlobs(actor, hashes),
    );
    // 페이지 판의 파일은 files(jsonb) 안에 있다
    this.blobs.registerUse(['blog.page_revisions.files'], (actor, hashes) =>
      this.pages.usedBlobs(actor, hashes),
    );
    // 앱 코드 버전의 파일도 files(jsonb) 안에 있다 (스토어 1-6)
    this.blobs.registerUse(['blog.app_code_versions.files'], (actor, hashes) =>
      this.appCode.usedBlobs(actor, hashes),
    );
  }
}
