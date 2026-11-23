import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { CurrentActor } from '../http/current-actor';
import { LibraryInput, TrashLibraryInput } from './library.input';
import { LibraryQuery } from './library.query';
import type { LibraryPageView, LibraryTrashedView } from './library.view';
import { LibraryTrashService } from './library-trash.service';

// 보관함 (2차 5단계). 주인만 (Query 첫 줄에서 확인)
@Controller('api/library')
export class LibraryController {
  constructor(
    private readonly library: LibraryQuery,
    private readonly trashes: LibraryTrashService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<LibraryPageView> {
    return this.library.list(actor, LibraryInput.from(query));
  }

  /** 고른 줄을 휴지통으로 { items: [{ kind, id }] } (주인만, 2026-11-23 일괄 지우기) */
  @Post('trash')
  @HttpCode(200)
  trash(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<LibraryTrashedView> {
    return this.trashes.trash(actor, TrashLibraryInput.from(body));
  }
}
