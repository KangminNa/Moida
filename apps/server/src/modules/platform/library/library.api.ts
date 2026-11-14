import { Controller, Get, Query } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { CurrentActor } from '../http/current-actor';
import { LibraryInput } from './library.input';
import { LibraryQuery } from './library.query';
import type { LibraryPageView } from './library.view';

// 보관함 (2차 5단계). 주인만 (Query 첫 줄에서 확인)
@Controller('api/library')
export class LibraryController {
  constructor(private readonly library: LibraryQuery) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<LibraryPageView> {
    return this.library.list(actor, LibraryInput.from(query));
  }
}
