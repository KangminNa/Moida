import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { CurrentActor } from '../http/current-actor';
import { FailedEventInput } from './failed-event.input';
import { FailedEventQuery } from './failed-event.query';
import { FailedEventService } from './failed-event.service';
import type { FailedEventListView, FailedEventView } from './failed-event.view';

// 멈춘 이벤트 (설정 › 일 › 처리 실패, 리팩토링 R1). 관리자만 (Query · Service 첫 줄에서 확인)
@Controller('api/events')
export class FailedEventController {
  constructor(
    private readonly query: FailedEventQuery,
    private readonly service: FailedEventService,
  ) {}

  @Get('failed')
  list(@CurrentActor() actor: Actor): Promise<FailedEventListView> {
    return this.query.list(actor);
  }

  @Post(':id/retry')
  @HttpCode(200)
  retry(@CurrentActor() actor: Actor, @Param() params: unknown): Promise<FailedEventView> {
    return this.service.retry(actor, FailedEventInput.from(params));
  }
}
