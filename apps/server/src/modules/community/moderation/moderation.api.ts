import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import {
  AdminListInput,
  AdminTopicInput,
  DecideInput,
  MemberDecideInput,
} from './moderation.input';
import { ModerationQuery } from './moderation.query';
import { ModerationService } from './moderation.service';
import type {
  AdminMemberView,
  AdminPageView,
  AdminReportView,
  AdminTopicLineView,
  AdminTopicView,
  ContentDecidedView,
  DecisionView,
  MemberDecidedView,
  MemberResetView,
} from './moderation.view';

// 커뮤니티 관리 (스토어 3-1c). 관리자만, 기본 도메인에서만 (앱 도메인에서는 HostGate가 admin/ 경로를 열지 않아 404).
// 앱은 공간의 커뮤니티 앱이어야 한다 (아니면 404). 회원 쿠키는 보지 않는다 (원칙 10).
//   GET  api/community/admin/:appId/topics?state=&cursor=      글 목록 (모든 상태)
//   GET  api/community/admin/:appId/topics/:id                 글 하나 + 모든 댓글
//   GET  api/community/admin/:appId/reports?state=&cursor=     신고 목록 (기본 open) + 대상
//   GET  api/community/admin/:appId/members?cursor=            회원 목록
//   GET  api/community/admin/:appId/decisions?cursor=          결정 기록
//   POST api/community/admin/:appId/topics/:id/decide          { version, action: hide · show · remove, note? }
//   POST api/community/admin/:appId/comments/:id/decide        { version, action, note? }
//   POST api/community/admin/:appId/members/:id/block          { version, until?, note? } (until이 없으면 무기한)
//   POST api/community/admin/:appId/members/:id/unblock        { version, note? }
//   POST api/community/admin/:appId/members/:id/reset-password { version, note? } → 임시 비밀번호 (이 응답에만)
// 결정은 있는 것을 바꾸므로 200
@Controller('api/community/admin/:appId')
export class ModerationController {
  constructor(
    private readonly query: ModerationQuery,
    private readonly moderation: ModerationService,
  ) {}

  @Get('topics')
  topics(
    @CurrentActor() actor: Actor,
    @Param('appId') appId: string,
    @Query() query: unknown,
  ): Promise<AdminPageView<AdminTopicLineView>> {
    return this.query.topics(actor, AdminListInput.from(appId, query));
  }

  @Get('topics/:id')
  topic(
    @CurrentActor() actor: Actor,
    @Param('appId') appId: string,
    @Param('id') id: string,
  ): Promise<AdminTopicView> {
    return this.query.topic(actor, AdminTopicInput.from(appId, id));
  }

  @Get('reports')
  reports(
    @CurrentActor() actor: Actor,
    @Param('appId') appId: string,
    @Query() query: unknown,
  ): Promise<AdminPageView<AdminReportView>> {
    return this.query.reports(actor, AdminListInput.from(appId, query));
  }

  @Get('members')
  members(
    @CurrentActor() actor: Actor,
    @Param('appId') appId: string,
    @Query() query: unknown,
  ): Promise<AdminPageView<AdminMemberView>> {
    return this.query.members(actor, AdminListInput.from(appId, query));
  }

  @Get('decisions')
  decisions(
    @CurrentActor() actor: Actor,
    @Param('appId') appId: string,
    @Query() query: unknown,
  ): Promise<AdminPageView<DecisionView>> {
    return this.query.decisions(actor, AdminListInput.from(appId, query));
  }

  @Post('topics/:id/decide')
  @HttpCode(200)
  async decideTopic(
    @CurrentActor() actor: Actor,
    @Param('appId') appId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ContentDecidedView> {
    const topic = await this.moderation.decide(actor, DecideInput.topic(appId, id, body));
    return topic.decidedView();
  }

  @Post('comments/:id/decide')
  @HttpCode(200)
  async decideComment(
    @CurrentActor() actor: Actor,
    @Param('appId') appId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ContentDecidedView> {
    const comment = await this.moderation.decide(actor, DecideInput.comment(appId, id, body));
    return comment.decidedView();
  }

  @Post('members/:id/block')
  @HttpCode(200)
  async block(
    @CurrentActor() actor: Actor,
    @Param('appId') appId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<MemberDecidedView> {
    const member = await this.moderation.block(actor, MemberDecideInput.from(appId, id, body));
    return member.decidedView();
  }

  @Post('members/:id/unblock')
  @HttpCode(200)
  async unblock(
    @CurrentActor() actor: Actor,
    @Param('appId') appId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<MemberDecidedView> {
    const member = await this.moderation.unblock(actor, MemberDecideInput.from(appId, id, body));
    return member.decidedView();
  }

  @Post('members/:id/reset-password')
  @HttpCode(200)
  async resetPassword(
    @CurrentActor() actor: Actor,
    @Param('appId') appId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<MemberResetView> {
    const member = await this.moderation.resetPassword(
      actor,
      MemberDecideInput.from(appId, id, body),
    );
    return member.resetView();
  }
}
