import { Module, type OnModuleInit } from '@nestjs/common';
import { CoreWorkers, EventCatalog, HostGate, PasswordHasher } from '../platform';
import { CommentController } from './comment/comment.api';
import { CommentService } from './comment/comment.service';
import events from './community.events.json';
import { CommunityNotices } from './community-notices';
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
// 다른 모듈과는 Lookups 'community-app'(blog)과 이벤트로만 잇는다: 나중에 같은 코드에서 진입점만 다른 컨테이너로 뗄 수 있게 (11.2)
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
  ],
  controllers: [
    MemberController,
    TopicController,
    CommentController,
    ReportController,
    ModerationController,
  ],
})
export class CommunityModule implements OnModuleInit {
  /** 앱 도메인에서 여는 경로: /api/community 아래, 관리자 경로(admin/)만 빼고 쓰기까지 */
  static readonly MEMBER_PATHS = /^\/api\/community\/(?!admin(?:\/|$))/;

  constructor(
    private readonly gate: HostGate,
    private readonly workers: CoreWorkers,
    private readonly reported: ReportAddedHandler,
  ) {}

  onModuleInit(): void {
    EventCatalog.define('community', events);
    this.gate.openPaths([CommunityModule.MEMBER_PATHS], true);
    // 신고가 쌓이면 임시로 가린다 (3-1c)
    this.workers.on(ReportAddedHandler.TOPIC, this.reported);
  }
}
