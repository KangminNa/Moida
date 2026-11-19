import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { type Actor, CurrentActor, type HttpRequest } from '../../platform';
import { MemberGuard } from '../guard/member.guard';
import { MemberPlace } from '../member/member.input';
import { ReportInput } from './report.input';
import { ReportService } from './report.service';
import type { ReportSavedView } from './report.view';

// 커뮤니티 신고 (스토어 3-1c). 앱 도메인에서만 (기본 도메인은 404), 회원만.
//   POST api/community/reports   { topicId | commentId, reason, note? } → 201 { id, createdAt }
@Controller('api/community/reports')
@UseGuards(MemberGuard)
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @Post()
  @HttpCode(201)
  async add(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<ReportSavedView> {
    const report = await this.reports.add(actor, MemberPlace.from(req), ReportInput.from(body));
    return report.savedView();
  }
}
