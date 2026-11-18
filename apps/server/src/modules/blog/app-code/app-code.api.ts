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
import { type Actor, CurrentActor, type HttpResponse, VersionInput } from '../../platform';
import { PageSiteAnswer } from '../page/page.query';
import {
  AppCodeIdInput,
  AppFileInput,
  AppScreenInput,
  CodeVersionInput,
  PreviewCodeInput,
  ShowCodeInput,
  UploadCodeInput,
} from './app-code.input';
import { AppCodeQuery } from './app-code.query';
import { AppCodeService } from './app-code.service';
import type {
  AppCodeChangesView,
  AppCodePreviewView,
  AppCodeStateView,
  AppCodeView,
} from './app-code.view';
import type { AppScreenRedirectView, AppScreenView } from './app-screen.view';
import { AppSiteQuery } from './app-site.query';

// 앱 코드 (스토어 1-6, docs/스토어.md 9.5). 관리자만: 코드 탭 · 바뀐 점 · zip 받기 · 올리기 · 공개 · 시작 코드로 · 미리 보기 주소.
// 기기 토큰 · AI는 버전을 공개하지 못한다 (원칙 7): AI의 버전은 만들기 작업의 이벤트로만 들어온다.
@Controller('api/apps/:id/code')
export class AppCodeController {
  constructor(
    private readonly query: AppCodeQuery,
    private readonly service: AppCodeService,
  ) {}

  @Get()
  code(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<AppCodeView> {
    return this.query.code(actor, AppCodeIdInput.from(id));
  }

  /** 버전 하나의 바뀐 점 (앞 버전 · 시작 코드와 파일 · 바깥 주소 비교) */
  @Get('versions/:seq/changes')
  changes(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('seq') seq: string,
  ): Promise<AppCodeChangesView> {
    return this.query.changes(actor, CodeVersionInput.from(id, seq));
  }

  /** 버전 하나(0은 시작 코드)를 zip으로 내려받기 */
  @Get('versions/:seq/zip')
  async zip(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('seq') seq: string,
  ): Promise<StreamableFile> {
    const archive = await this.query.zip(actor, CodeVersionInput.from(id, seq));
    return new StreamableFile(archive.bytes, {
      type: 'application/zip',
      disposition: `attachment; filename="${archive.fileName}"`,
      length: archive.bytes.length,
    });
  }

  /** zip 올리기: 본문이 zip 파일 그대로 (application/zip, HttpSetup이 그대로 받는다) */
  @Post('versions')
  async upload(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Query() query: unknown,
    @Body() body: unknown,
  ): Promise<AppCodeStateView> {
    return (await this.service.upload(actor, UploadCodeInput.from(id, query, body))).view();
  }

  /** 이 버전 공개 (확인 대기 버전 · 앞 버전으로 되돌리기) */
  @HttpCode(200)
  @Post('current')
  async show(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AppCodeStateView> {
    return (await this.service.show(actor, ShowCodeInput.from(id, body))).view();
  }

  /** 시작 코드를 새 버전으로 (처음으로 되돌리기) */
  @HttpCode(200)
  @Post('starter')
  async starter(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AppCodeStateView> {
    return (await this.service.starter(actor, VersionInput.from(id, body))).view();
  }

  /** 미리 보기 주소 (토큰 30분). 본문 { seq? }: 없으면 보이는 버전, 0은 시작 코드 */
  @HttpCode(200)
  @Post('preview')
  preview(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AppCodePreviewView> {
    return this.query.preview(actor, PreviewCodeInput.from(id, body), new Date());
  }
}

// 방문자가 보는 앱 화면 (스토어 1-6). 웹의 /<앱>/…가 화면 하나(템플릿 · 바깥 주소 · 데이터)를, /<앱>/files/<이름>이 파일을 받는다.
// 그리기와 화면의 격리 머리글은 웹이 붙인다. 파일은 여기서도 격리 머리글을 붙여 내보낸다 (주소를 직접 열어도 격리된다).
@Controller('api/apps/site/:slug')
export class AppSiteController {
  constructor(private readonly site: AppSiteQuery) {}

  @Get('screen')
  screen(
    @CurrentActor() actor: Actor,
    @Param('slug') slug: string,
    @Query() query: unknown,
  ): Promise<AppScreenView | AppScreenRedirectView> {
    return this.site.screen(actor, AppScreenInput.from(slug, query), new Date());
  }

  @Get('files/:name')
  async file(
    @CurrentActor() actor: Actor,
    @Param('slug') slug: string,
    @Param('name') name: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<StreamableFile> {
    const file = await this.site.file(actor, AppFileInput.from(slug, name, query), new Date());
    res.setHeader('Content-Security-Policy', PageSiteAnswer.CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', file.cacheControl);
    return new StreamableFile(file.stream, {
      type: file.type,
      disposition: 'inline',
      length: file.size,
    });
  }
}
