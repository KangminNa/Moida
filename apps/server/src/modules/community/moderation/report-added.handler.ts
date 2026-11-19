import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { Report } from '../report/report';
import { ReportedInput } from './moderation.input';
import { ModerationService } from './moderation.service';

// 신고가 들어오면 (community.report.added) 대상의 신고를 세어 임시로 가린다 (스토어 3-1c).
// 신고와 가림을 한 트랜잭션에 두지 않아 신고 묶음이 글 · 댓글을 쓰지 않는다. 두 번 받아도 한 번만 가린다
@Injectable()
export class ReportAddedHandler extends BaseHandler {
  static readonly TOPIC = Report.ADDED;

  constructor(private readonly moderation: ModerationService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    await this.moderation.hideByReports(
      new SystemActor(),
      event.spaceId,
      ReportedInput.from(event.data),
    );
  }
}
