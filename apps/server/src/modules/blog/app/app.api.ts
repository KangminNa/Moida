import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { type Actor, CurrentActor, type HttpResponse, VersionInput } from '../../platform';
import { AppSlugInput, CreateAppInput, UpdateAppInput, UploadIconInput } from './app.input';
import { AppQuery } from './app.query';
import { AppService } from './app.service';
import type { AppListView, AppView, PublicAppListView, PublicAppView } from './app.view';

// 앱 API (스토어 1단계). 목록 · 앱 머리 · 아이콘은 누구나(방문자는 공개 앱만), 만들기 · 고치기 · 지우기 · 아이콘 올리기는 관리자만.
@Controller('api/apps')
export class AppController {
  constructor(
    private readonly query: AppQuery,
    private readonly service: AppService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor): Promise<AppListView | PublicAppListView> {
    return this.query.list(actor);
  }

  @Get('by-slug/:slug')
  bySlug(
    @CurrentActor() actor: Actor,
    @Param('slug') slug: string,
  ): Promise<AppView | PublicAppView> {
    return this.query.bySlug(actor, AppSlugInput.from(slug));
  }

  /** 앱 아이콘. 브라우저가 형식을 짐작하지 못하게 하고, 그림 안의 무엇도 돌지 않게 sandbox (사이트 로고와 같다) */
  @Get('by-slug/:slug/icon')
  async icon(
    @CurrentActor() actor: Actor,
    @Param('slug') slug: string,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<StreamableFile> {
    const file = await this.query.icon(actor, AppSlugInput.from(slug));
    res.setHeader('Cache-Control', file.cacheControl);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', 'sandbox');
    return new StreamableFile(file.stream, {
      type: file.blob.mime,
      disposition: 'inline',
      length: file.blob.size,
    });
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<AppView> {
    return (await this.service.create(actor, CreateAppInput.from(body))).view();
  }

  @Patch(':id')
  async update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AppView> {
    return (await this.service.update(actor, UpdateAppInput.from(id, body))).view();
  }

  @HttpCode(204)
  @Post(':id/delete')
  async remove(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.service.remove(actor, VersionInput.from(id, body));
  }

  /** 아이콘 올리기. 본문은 그림 파일 그대로 (HttpSetup이 image/*를 받는다) */
  @Put(':id/icon')
  async uploadIcon(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Query() query: unknown,
    @Body() body: unknown,
  ): Promise<AppView> {
    return (await this.service.uploadIcon(actor, UploadIconInput.from(id, query, body))).view();
  }

  @HttpCode(200)
  @Post(':id/icon/delete')
  async removeIcon(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AppView> {
    return (await this.service.removeIcon(actor, VersionInput.from(id, body))).view();
  }
}
