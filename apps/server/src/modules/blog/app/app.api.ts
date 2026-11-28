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
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  type Actor,
  CurrentActor,
  type HttpRequest,
  type HttpResponse,
  VersionInput,
} from '../../platform';
import {
  AppSlugInput,
  CheckDomainInput,
  CreateAppInput,
  DomainProofInput,
  HomeAppInput,
  RemoveAppInput,
  UpdateAppInput,
  UploadIconInput,
} from './app.input';
import { type AppDomainProofAnswer, AppQuery } from './app.query';
import { AppService } from './app.service';
import type {
  AppDomainListView,
  AppListView,
  AppView,
  PublicAppListView,
  PublicAppView,
} from './app.view';

// 앱 API (스토어 1단계). 목록 · 앱 머리 · 아이콘은 누구나(방문자는 공개 앱만), 만들기 · 고치기 · 지우기 · 아이콘 올리기 · 첫 화면 고정(2단계)은 관리자만.
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

  /** 도메인으로 여는 공개 앱 (스토어 3-0): 웹이 요청의 Host로 앱을 고른다 */
  @Get('domains')
  domains(@CurrentActor() actor: Actor): Promise<AppDomainListView> {
    return this.query.domains(actor);
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

  /** 방문자 첫 화면으로 고정할 앱 (스토어 2단계). 화면은 목록을 다시 읽는다 */
  @HttpCode(204)
  @Put('home')
  async pinHome(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<void> {
    await this.service.pinHome(actor, HomeAppInput.from(body));
  }

  @Patch(':id')
  async update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AppView> {
    return (await this.service.update(actor, UpdateAppInput.from(id, body))).view();
  }

  /** 도메인 연결 확인 (스토어 3-0): 관리자의 브라우저가 그 도메인의 /.well-known/moida-domain에서 읽은 값 */
  @HttpCode(200)
  @Post(':id/domain/check')
  async checkDomain(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AppView> {
    return (await this.service.checkDomain(actor, CheckDomainInput.from(id, body))).view();
  }

  @HttpCode(204)
  @Post(':id/delete')
  async remove(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.service.remove(actor, RemoveAppInput.from(id, body));
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

// 도메인 연결 확인 값 (스토어 3-0): 앱 도메인으로 온 요청(HostGate가 적은 appHost)에만 답하고, 기본 도메인 · 모르는 도메인은 404.
// 관리자의 브라우저가 기본 도메인의 화면에서 읽으므로 그 출처(사이트 주소)만 읽게 한다. 표준 경로라 /api 아래가 아니다 (OAuth와 같다)
@Controller('.well-known')
export class AppDomainController {
  constructor(private readonly query: AppQuery) {}

  @Get('moida-domain')
  async proof(
    @CurrentActor() actor: Actor,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<AppDomainProofAnswer> {
    const answer = await this.query.domainProof(
      actor,
      DomainProofInput.from(req.appHost, req.headers.origin),
    );
    res.setHeader('Vary', 'Origin');
    if (answer.allowOrigin) res.setHeader('Access-Control-Allow-Origin', answer.allowOrigin);
    return answer;
  }
}
