import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { type Actor, CurrentActor, type HttpResponse } from '../../platform';
import {
  CreateOutputShareInput,
  EndOutputShareInput,
  ListOutputSharesInput,
  OpenOutputShareInput,
} from './output-share.input';
import { OutputShareQuery } from './output-share.query';
import { OutputShareService } from './output-share.service';
import type { OutputShareListView, OutputShareView } from './output-share.view';

// 결과물 공유 링크 API (기획서 결정 2026-11-19). 목록 · 만들기 · 끄기는 관리자만, 링크로 열기는 누구나.
@Controller('api/output-shares')
export class OutputShareController {
  constructor(
    private readonly query: OutputShareQuery,
    private readonly service: OutputShareService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<OutputShareListView> {
    return this.query.list(actor, ListOutputSharesInput.from(query).outputId);
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<OutputShareView> {
    return this.service.create(actor, CreateOutputShareInput.from(body));
  }

  @Post(':id/end')
  @HttpCode(200)
  end(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<OutputShareView> {
    return this.service.end(actor, EndOutputShareInput.from(id));
  }

  /**
   * 링크로 연 파일 (웹의 /share/<토큰>). 격리 머리글 + 어느 사이트의 틀에도 넣지 않고, 주소를 Referer로 넘기지 않고,
   * 검색에 올리지 않고, 끈 링크가 캐시로 남지 않게
   */
  @Get('open/:token')
  async open(
    @CurrentActor() actor: Actor,
    @Param('token') token: string,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<StreamableFile> {
    const file = await this.query.open(actor, OpenOutputShareInput.from(token).token);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', file.sharedCsp);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(file.stream, {
      type: file.mime,
      disposition: file.disposition,
      length: file.size,
    });
  }
}
