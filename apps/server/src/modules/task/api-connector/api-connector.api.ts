import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { type Actor, CurrentActor, VersionInput } from '../../platform';
import { ApiCallService } from './api-call.service';
import { ApiKeysInput, TryApiInput, UpdateApiConnectorInput } from './api-connector.input';
import { ApiConnectorQuery } from './api-connector.query';
import { ApiConnectorService } from './api-connector.service';
import type {
  ApiCallLineView,
  ApiCallListView,
  ApiConnectorListView,
  ApiConnectorView,
} from './api-connector.view';

// API 커넥터 API (2026-11-24, 관리자만). Input 만들기 → Service·Query 메서드 하나 → View. 권한은 Service·Query 첫 줄에서.
// 커넥터는 일꾼이 제안하고 승인으로 켠다 (만들기 API는 없다). 키는 넣기만 하고 돌려주지 않는다 (keys[].set만)
@Controller('api/api-connectors')
export class ApiConnectorController {
  constructor(
    private readonly query: ApiConnectorQuery,
    private readonly service: ApiConnectorService,
    private readonly calls: ApiCallService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor): Promise<ApiConnectorListView> {
    return this.query.list(actor);
  }

  /** 이름표 · 하루 한도(dailyMax) · 켜기(enabled) */
  @Patch(':id')
  update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ApiConnectorView> {
    return this.service.update(actor, UpdateApiConnectorInput.from(id, body));
  }

  /** 머리글마다 키 { version, keys: { 머리글: 값 } }. 넣은 것만 바꾼다 */
  @Post(':id/keys')
  @HttpCode(200)
  keys(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ApiConnectorView> {
    return this.service.setKeys(actor, ApiKeysInput.from(id, body));
  }

  /** 관리자의 시험 { requestId, operation, input }: 관리자가 누른 것이 승인이다. 오래 걸리면 calls로 본다 */
  @Post(':id/try')
  @HttpCode(200)
  async tryOut(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ApiCallLineView> {
    return (await this.calls.tryOut(actor, TryApiInput.from(id, body))).lineView();
  }

  /** 최근 부르기 20개 */
  @Get(':id/calls')
  recent(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<ApiCallListView> {
    return this.query.calls(actor, id);
  }

  @Post(':id/delete')
  @HttpCode(204)
  remove(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.service.remove(actor, VersionInput.from(id, body));
  }
}
