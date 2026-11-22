import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { type Actor, CurrentActor, type HttpRequest, type HttpResponse } from '../../platform';
import { MemberGuard } from '../guard/member.guard';
import { MemberPlace } from '../member/member.input';
import {
  AdminAppInput,
  AdminDataInput,
  AdminRowInput,
  AdminRowsInput,
  DataEditInput,
  DataListInput,
  DataRowInput,
  DataWriteInput,
} from './app-data.input';
import { AppDataQuery } from './app-data.query';
import { AppDataService } from './app-data.service';
import type { AppRowsAddedView, AppRowsView, AppRowView, AppTablesView } from './app-data.view';

// 앱 데이터 (스토어 12.4). 앱 도메인에서만 (기본 도메인은 404). 표 · 칸은 그 앱의 보이는 버전이 cairn.json에 선언한 것.
//   GET    api/community/data/:table?<칸>=<연산>.<값>&order=&limit=&offset=   줄 읽기 (읽기 규칙은 DB가 거른다)
//   POST   api/community/data/:table           줄 만들기 { 칸: 값 } (회원, 쓰기 규칙 member · owner)
//   PATCH  api/community/data/:table/:id       자기 줄 고치기 { 칸: 값 } (쓰기 규칙 owner)
//   DELETE api/community/data/:table/:id       자기 줄 지우기 (쓰기 규칙 owner)
@Controller('api/community/data')
@UseGuards(MemberGuard)
export class AppDataController {
  constructor(
    private readonly query: AppDataQuery,
    private readonly data: AppDataService,
  ) {}

  @Get(':table')
  list(
    @CurrentActor() actor: Actor,
    @Param('table') table: string,
    @Req() req: HttpRequest,
  ): Promise<AppRowsView> {
    return this.query.list(actor, MemberPlace.from(req), DataListInput.from(table, req.query));
  }

  @Post(':table')
  @HttpCode(201)
  insert(
    @CurrentActor() actor: Actor,
    @Param('table') table: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<AppRowView> {
    return this.data.insert(actor, MemberPlace.from(req), DataWriteInput.from(table, body));
  }

  @Patch(':table/:id')
  update(
    @CurrentActor() actor: Actor,
    @Param('table') table: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<AppRowView> {
    return this.data.update(actor, MemberPlace.from(req), DataEditInput.from(table, id, body));
  }

  @Delete(':table/:id')
  @HttpCode(204)
  delete(
    @CurrentActor() actor: Actor,
    @Param('table') table: string,
    @Param('id') id: string,
    @Req() req: HttpRequest,
  ): Promise<void> {
    return this.data.delete(actor, MemberPlace.from(req), DataRowInput.from(table, id));
  }
}

// 앱 데이터 관리 (스토어 12.4 · 12.5). 관리자만, 기본 도메인에서만 (앱 도메인에서는 HostGate가 admin/을 열지 않는다).
//   GET    api/community/admin/:appId/data                 표 목록 (선언 · 줄 수)
//   GET    api/community/admin/:appId/data/:table          줄 읽기 (모든 줄, 조건 · 정렬은 회원 쪽과 같다)
//   POST   api/community/admin/:appId/data/:table          줄 넣기 { rows: [{ 칸: 값 }] }
//   DELETE api/community/admin/:appId/data/:table/:id      줄 지우기
//   GET    api/community/admin/:appId/export               앱 데이터 · 회원 내보내기 (zip)
@Controller('api/community/admin/:appId')
export class AppDataAdminController {
  constructor(
    private readonly query: AppDataQuery,
    private readonly data: AppDataService,
  ) {}

  @Get('data')
  tables(@CurrentActor() actor: Actor, @Param('appId') appId: string): Promise<AppTablesView> {
    return this.query.tables(actor, AdminAppInput.from(appId));
  }

  @Get('data/:table')
  rows(
    @CurrentActor() actor: Actor,
    @Param('appId') appId: string,
    @Param('table') table: string,
    @Query() query: unknown,
  ): Promise<AppRowsView> {
    return this.query.adminRows(actor, AdminDataInput.from(appId, table, query));
  }

  @Post('data/:table')
  @HttpCode(201)
  add(
    @CurrentActor() actor: Actor,
    @Param('appId') appId: string,
    @Param('table') table: string,
    @Body() body: unknown,
  ): Promise<AppRowsAddedView> {
    return this.data.addRows(actor, AdminRowsInput.from(appId, table, body));
  }

  @Delete('data/:table/:id')
  @HttpCode(204)
  remove(
    @CurrentActor() actor: Actor,
    @Param('appId') appId: string,
    @Param('table') table: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.data.removeRow(actor, AdminRowInput.from(appId, table, id));
  }

  @Get('export')
  async export(
    @CurrentActor() actor: Actor,
    @Param('appId') appId: string,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<StreamableFile> {
    const file = await this.query.export(actor, AdminAppInput.from(appId), new Date());
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(file.bytes, {
      type: 'application/zip',
      disposition: `attachment; filename="${file.fileName}"`,
      length: file.bytes.length,
    });
  }
}
