import { Module, type OnModuleInit } from '@nestjs/common';
import { CoreWorkers, EventCatalog, HostGate, Lookups, PasswordHasher } from '../platform';
import { CommentController } from './comment/comment.api';
import { CommentService } from './comment/comment.service';
import events from './community.events.json';
import { CommunityNotices } from './community-notices';
import { CommunitySettings } from './community-settings';
import { AppDataAdminController, AppDataController } from './data/app-data.api';
import { AppDataQuery } from './data/app-data.query';
import { AppDataService } from './data/app-data.service';
import { AppTablesHandler } from './data/app-tables.handler';
import { MemberGuard } from './guard/member.guard';
import { MemberController } from './member/member.api';
import { MemberQuery } from './member/member.query';
import { MemberService } from './member/member.service';
import { ModerationController } from './moderation/moderation.api';
import { ModerationQuery } from './moderation/moderation.query';
import { ModerationService } from './moderation/moderation.service';
import { ReportAddedHandler } from './moderation/report-added.handler';
import { ReportController } from './report/report.api';
import { ReportService } from './report/report.service';
import { TopicController } from './topic/topic.api';
import { TopicQuery } from './topic/topic.query';
import { TopicService } from './topic/topic.service';

// 커뮤니티 (스토어 3단계, docs/스토어.md 11장): 앱 도메인의 회원 · 글 · 댓글 · 신고, 기본 도메인의 관리(3-1c). 관리자 계정(account)과 표 · 쿠키 · 권한을 나눈다 (원칙 10).
// 앱 플랫폼 (스토어 12장)에서 뜻이 넓어졌다: 커뮤니티 앱만이 아니라 회원을 받는 모든 앱의 회원(12.3)과 앱 데이터(data/, 12.4)를 맡는다.
// 다른 모듈과는 Lookups 'app' · 'community-app' · 'member-app'(blog)과 이벤트로만 잇는다: 나중에 같은 코드에서 진입점만 다른 컨테이너로 뗄 수 있게 (11.2)
@Module({
  providers: [
    { provide: PasswordHasher, useValue: new PasswordHasher() },
    MemberQuery,
    MemberService,
    MemberGuard,
    TopicQuery,
    TopicService,
    CommentService,
    ReportService,
    ModerationQuery,
    ModerationService,
    ReportAddedHandler,
    CommunityNotices,
    AppDataQuery,
    AppDataService,
    AppTablesHandler,
    CommunitySettings,
  ],
  controllers: [
    MemberController,
    TopicController,
    CommentController,
    ReportController,
    ModerationController,
    AppDataController,
    AppDataAdminController,
  ],
})
export class CommunityModule implements OnModuleInit {
  /** 앱 도메인에서 여는 경로: /api/community 아래, 관리자 경로(admin/)만 빼고 쓰기까지 */
  static readonly MEMBER_PATHS = /^\/api\/community\/(?!admin(?:\/|$))/;

  constructor(
    private readonly gate: HostGate,
    private readonly workers: CoreWorkers,
    private readonly reported: ReportAddedHandler,
    private readonly tables: AppTablesHandler,
    private readonly lookups: Lookups,
    private readonly data: AppDataQuery,
  ) {}

  onModuleInit(): void {
    EventCatalog.define('community', events);
    this.gate.openPaths([CommunityModule.MEMBER_PATHS], true);
    // 신고가 쌓이면 임시로 가린다 (3-1c)
    this.workers.on(ReportAddedHandler.TOPIC, this.reported);
    // 앱의 보이는 버전이 바뀌면 그 버전이 선언한 표에 맞춘다 (앱 데이터, 스토어 12.4)
    this.workers.on(AppTablesHandler.TOPIC, this.tables);
    // 남은 회원 · 앱 데이터 (2026-11-23): blog가 앱을 지우기 전에 묻는다. 있으면 지우지 않는다
    this.lookups.provide('app-holdings', (a, ids) => this.data.holdings(a, ids));
  }
}
