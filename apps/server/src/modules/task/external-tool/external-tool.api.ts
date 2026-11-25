import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import type { TaskView } from '../task/task.view';
import {
  ApproveCatalogInput,
  CheckExternalToolInput,
  CreateExternalToolInput,
  ExternalToolSecretInput,
  RemoveExternalToolInput,
  UpdateExternalToolInput,
} from './external-tool.input';
import { ExternalToolQuery } from './external-tool.query';
import { ExternalToolService } from './external-tool.service';
import type { ExternalToolListView, ExternalToolView } from './external-tool.view';
import { ExternalToolCheckService } from './external-tool-check.service';

// 외부 도구 API (2차 7단계, 관리자만). Input 만들기 → Service·Query 메서드 하나 → View. 권한은 Service·Query 첫 줄에서.
// 토큰은 넣기만 하고 돌려주지 않는다 (hasSecret만).
@Controller('api/external-tools')
export class ExternalToolController {
  constructor(
    private readonly query: ExternalToolQuery,
    private readonly service: ExternalToolService,
    private readonly checks: ExternalToolCheckService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor): Promise<ExternalToolListView> {
    return this.query.list(actor);
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<ExternalToolView> {
    return (await this.service.create(actor, CreateExternalToolInput.from(body))).view();
  }

  @Patch(':id')
  async update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ExternalToolView> {
    return (await this.service.update(actor, UpdateExternalToolInput.from(id, body))).view();
  }

  /** 연결 확인 (2026-11-15 MCP 1단계): 러너가 tools/list를 받아 오는 일 하나. 결과는 목록의 catalog · checkedAt · checkError */
  @Post(':id/check')
  @HttpCode(202)
  async check(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<TaskView> {
    return (await this.checks.check(actor, CheckExternalToolInput.from(id))).view();
  }

  /** 바뀐 도구 목록 승인 (C3): 본 바뀐 때(changedAt)와 함께. 그사이 또 바뀌었으면 409 */
  @Post(':id/catalog/approve')
  @HttpCode(204)
  async approveCatalog(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.checks.approveCatalog(actor, ApproveCatalogInput.from(id, body));
  }

  @Post(':id/secret')
  @HttpCode(200)
  async secret(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ExternalToolView> {
    return (await this.service.setSecret(actor, ExternalToolSecretInput.from(id, body))).view();
  }

  @Post(':id/delete')
  @HttpCode(204)
  remove(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.service.remove(actor, RemoveExternalToolInput.from(id, body));
  }
}
