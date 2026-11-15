import { Controller, Get, Query } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { CurrentActor } from '../http/current-actor';
import { SecurityEventsInput } from './security-event.input';
import { SecurityEventQuery } from './security-event.query';
import type { SecurityEventPageView } from './security-event.view';

// 보안 기록 (설정 › 보안). 관리자만 (Query 첫 줄에서 확인)
@Controller('api/security')
export class SecurityEventController {
  constructor(private readonly events: SecurityEventQuery) {}

  @Get('events')
  list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<SecurityEventPageView> {
    return this.events.page(actor, SecurityEventsInput.from(query));
  }
}
