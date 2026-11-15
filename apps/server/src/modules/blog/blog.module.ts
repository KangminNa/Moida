import { Module, type OnModuleInit } from '@nestjs/common';
import { ActionChecks, BlobStore, CoreWorkers, EventCatalog, LibraryQuery } from '../platform';
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
import { Post } from './post/post';
import { PostController } from './post/post.api';
import { PostQuery } from './post/post.query';
import { PostService } from './post/post.service';
import { BlogGetPostTool, BlogSaveDraftTool } from './post/post.tool';
import { PostArchiveQuery } from './post/post-archive.query';
import { PublishApprovedHandler } from './post/publish-approved.handler';

// 방문자가 읽는 블로그와 글을 쓰는 재료: 글(쓰기·고치기·공개 범위·휴지통), 사진, 소재, AI 도구의 초안.
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
  ],
  controllers: [
    PostController,
    AssetController,
    FileController,
    BasketController,
    PageController,
    MenuController,
    IssueController,
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
    private readonly checks: ActionChecks,
    private readonly issuePublish: IssuePublishHandler,
    private readonly issues: IssueQuery,
  ) {}

  onModuleInit(): void {
    EventCatalog.define('blog', events);
    this.workers.on(PublishApprovedHandler.TOPIC, this.approved);
    this.workers.on(PublishApprovedHandler.TOPIC, this.issuePublish);
    this.workers.expect(PublishApprovedHandler.TOPIC);
    // 만들기 작업이 끝나며 알린 페이지 (task가 보낸다)
    this.workers.on(PageBuiltHandler.TOPIC, this.built);
    // 보관함 (2차 5단계): 페이지 · 글 · 읽은 글(소재의 링크)
    this.library.register([PageQuery.LIBRARY_KIND], (a, f) => this.pages.library(a, f));
    this.library.register([PostQuery.LIBRARY_KIND], (a, f) => this.posts.library(a, f));
    this.library.register([BasketQuery.LIBRARY_KIND], (a, f) => this.basket.library(a, f));
    // 결과 카드 전에 발행의 빠진 점 (2차 6단계): 메뉴에 올리지 않은 글
    this.checks.register(Post.PUBLISH_ACTION, (a, id) => this.posts.publishProblem(a, id));
    this.checks.register(Issue.ACTION, (a, id) => this.issues.publishProblem(a, id));
    // 파일을 가리키는 칸: 쓰는 동안 platform이 파일을 지우지 않게
    this.blobs.registerUse(
      ['blog.assets.blob_hash', 'blog.posts.cover_blob_hash'],
      (actor, hashes) => this.assets.usedBlobs(actor, hashes),
    );
    this.blobs.registerUse(['work.basket_items.blob_hash'], (actor, hashes) =>
      this.basket.usedBlobs(actor, hashes),
    );
    // 페이지 판의 파일은 files(jsonb) 안에 있다
    this.blobs.registerUse(['blog.page_revisions.files'], (actor, hashes) =>
      this.pages.usedBlobs(actor, hashes),
    );
  }
}
