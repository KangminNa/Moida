import { Module, type OnModuleInit } from '@nestjs/common';
import { CoreWorkers, EventCatalog, LibraryQuery, LibraryTrashService, Lookups } from '../platform';
import { AppMarkHandler } from './app-mark/app-mark.handler';
import { AppMarkService } from './app-mark/app-mark.service';
import { CategoryController } from './category/category.api';
import { CategoryQuery } from './category/category.query';
import { ChangeController } from './change/change.api';
import { ChangeQuery } from './change/change.query';
import { ChangeService } from './change/change.service';
import { SubmitChangesTool } from './change/change.tool';
import { ReviewPolicy } from './change/review.policy';
import { GraphController } from './graph/graph.api';
import { GraphQuery } from './graph/graph.query';
import { NeighborsTool } from './graph/graph.tool';
import { PostMarkHandler } from './post-mark/post-mark.handler';
import { PostMarkService } from './post-mark/post-mark.service';
import { PostWikiQuery } from './post-mark/post-wiki.query';
import { ProjectRuleController } from './project/project-rule.api';
import { ProjectRuleQuery } from './project/project-rule.query';
import { ProjectRuleService } from './project/project-rule.service';
import { RunMemosTool, SaveRunRecordTool } from './session/run-record.tool';
import { SessionController } from './session/session.api';
import { TrashSessionsInput } from './session/session.input';
import { SessionQuery } from './session/session.query';
import { SessionService } from './session/session.service';
import {
  CheckSessionTool,
  GetSessionTool,
  SaveSessionTool,
  SearchSessionsTool,
} from './session/session.tool';
import { ReadTranscriptTool, SaveNoteTool, SaveTranscriptTool } from './session/transcript.tool';
import { TidyController } from './tidy/tidy.api';
import { TidyQuery } from './tidy/tidy.query';
import { TidyService } from './tidy/tidy.service';
import { TidyDailyJob } from './tidy/tidy-daily.job';
import { TidyRequestHandler } from './tidy/tidy-request.handler';
import events from './vault.events.json';
import { ArchiveController } from './vault-archive.api';
import { VaultArchiveQuery } from './vault-archive.query';
import { VaultNotices } from './vault-notices';
import { VaultSettings } from './vault-settings';
import { VaultTools } from './vault-tools';
import { WikiController } from './wiki/wiki.api';
import { TrashWikisInput } from './wiki/wiki.input';
import { WikiQuery } from './wiki/wiki.query';
import { GetWikiTool, SearchWikisTool } from './wiki/wiki.tool';
import { WikiScoreController } from './wiki-score/wiki-score.api';
import { WikiScoreQuery } from './wiki-score/wiki-score.query';
import { WikiScoreService } from './wiki-score/wiki-score.service';
import { WikiStaleJob } from './wiki-score/wiki-stale.job';

// AI 작업 세션과 그래프: 세션 저장·찾기·읽기(원문 · 프로젝트 규칙 포함), wiki · 카테고리, 변경 묶음(검토·되돌리기), 세션 정리 요청,
// 그래프 보기, 글 자리 사본, 보관 형식 내보내기, wiki 점수.
@Module({
  providers: [
    VaultNotices,
    VaultSettings,
    SessionService,
    SessionQuery,
    SaveSessionTool,
    CheckSessionTool,
    SearchSessionsTool,
    GetSessionTool,
    SaveTranscriptTool,
    ReadTranscriptTool,
    SaveNoteTool,
    RunMemosTool,
    SaveRunRecordTool,
    ProjectRuleQuery,
    ProjectRuleService,
    ReviewPolicy,
    ChangeService,
    ChangeQuery,
    SubmitChangesTool,
    WikiQuery,
    SearchWikisTool,
    GetWikiTool,
    WikiScoreQuery,
    WikiScoreService,
    WikiStaleJob,
    CategoryQuery,
    TidyQuery,
    TidyService,
    TidyRequestHandler,
    TidyDailyJob,
    PostMarkService,
    PostMarkHandler,
    AppMarkHandler,
    AppMarkService,
    PostWikiQuery,
    GraphQuery,
    NeighborsTool,
    VaultArchiveQuery,
    VaultTools,
  ],
  controllers: [
    SessionController,
    ProjectRuleController,
    WikiController,
    WikiScoreController,
    CategoryController,
    ChangeController,
    TidyController,
    GraphController,
    ArchiveController,
  ],
  exports: [VaultTools],
})
export class VaultModule implements OnModuleInit {
  constructor(
    private readonly workers: CoreWorkers,
    private readonly tidy: TidyRequestHandler,
    private readonly tidyDaily: TidyDailyJob,
    private readonly postMarks: PostMarkHandler,
    private readonly appMarks: AppMarkHandler,
    private readonly stale: WikiStaleJob,
    private readonly library: LibraryQuery,
    private readonly sessions: SessionQuery,
    private readonly wikis: WikiQuery,
    private readonly lookups: Lookups,
    private readonly postWikis: PostWikiQuery,
    private readonly libraryTrash: LibraryTrashService,
    private readonly changes: ChangeService,
  ) {}

  onModuleInit(): void {
    EventCatalog.define('vault', events);
    this.workers.on('vault.session.saved', this.tidy);
    // 모듈 사이 읽기 (리팩토링 R3b): blog가 글의 wiki · 스크랩의 세션을 vault를 가져오지 않고 확인한다
    this.lookups.provide('wiki', (a, ids) => this.postWikis.visible(a, ids));
    this.lookups.provide('session', (a, ids) => this.sessions.titles(a, ids));
    // 보관함 (2차 5단계): 세션 · 위키
    this.library.register([SessionQuery.LIBRARY_KIND], (a, f) => this.sessions.library(a, f));
    this.library.register([WikiQuery.LIBRARY_KIND], (a, f) => this.wikis.library(a, f));
    // 보관함의 일괄 지우기 (2026-11-23): 지금 판을 읽어 한 변경 묶음으로 휴지통에 (되살릴 수 있다)
    this.libraryTrash.register([SessionQuery.LIBRARY_KIND], async (a, ids) =>
      this.changes.trashMany(a, TrashSessionsInput.of(await this.sessions.liveVersions(a, ids))),
    );
    this.libraryTrash.register([WikiQuery.LIBRARY_KIND], async (a, ids) =>
      this.changes.trashMany(a, TrashWikisInput.of(await this.wikis.liveVersions(a, ids))),
    );
    this.workers.on('blog.post.*', this.postMarks);
    // 앱 공개 여부 사본 (스토어 1-2): 방문자 그래프는 앱도 공개인 글만
    this.workers.on(AppMarkHandler.TOPIC, this.appMarks);
    this.workers.every(this.stale, WikiStaleJob.EVERY_MS);
    // 세션 정리를 하루 한 번 몰아서 (2차 7단계)
    this.workers.due(this.tidyDaily);
  }
}
