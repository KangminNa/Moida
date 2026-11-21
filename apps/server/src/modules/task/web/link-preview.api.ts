import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import { type Actor, CurrentActor, type HttpResponse } from '../../platform';
import { LinkPreviewQuery } from './link-preview.query';
import type { LinkPreviewView } from './link-preview.view';
import { ReadUrlInput } from './web.input';

// 링크 미리보기 API (F3, 2026-11-21, 관리자만): 대화의 답에 있는 주소의 카드와 그 대표 그림
@Controller('api/link-preview')
export class LinkPreviewController {
  constructor(private readonly previews: LinkPreviewQuery) {}

  @Get()
  preview(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<LinkPreviewView> {
    return this.previews.preview(actor, ReadUrlInput.from(query));
  }

  /** 대표 그림: 앞부분으로 알아본 그림 형식으로만, 스크립트 · 다른 출처에 닿지 않게 격리하고 브라우저가 하루 기억한다 */
  @Get('image')
  async image(
    @CurrentActor() actor: Actor,
    @Query() query: unknown,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<StreamableFile> {
    const image = await this.previews.image(actor, ReadUrlInput.from(query));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return new StreamableFile(image.bytes, { type: image.mime, length: image.bytes.length });
  }
}
