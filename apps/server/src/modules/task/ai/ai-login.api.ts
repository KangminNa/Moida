import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { AiSigninCodeInput, AiTokenInput, AiToolInput } from './ai-login.input';
import { AiLoginQuery } from './ai-login.query';
import { AiLoginService } from './ai-login.service';
import type { AiTestView, AiToolListView, AiToolView, EngineListView } from './ai-login.view';

// AI 메뉴. 주인만 (Service·Query 첫 줄에서 확인). 토큰은 어느 응답에도 다시 보내지 않는다.
@Controller('api/ai')
export class AiLoginController {
  constructor(
    private readonly logins: AiLoginQuery,
    private readonly service: AiLoginService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor): Promise<AiToolListView> {
    return this.logins.list(actor);
  }

  /** 엔진 목록 (task/engines.json, 리팩토링 E1): 화면이 도구 이름 · 생각 강도 · 모델 · 로그인 흐름을 여기서 읽는다 */
  @Get('engines')
  engines(@CurrentActor() actor: Actor): EngineListView {
    return this.logins.engines(actor);
  }

  /** 토큰을 넣은 뒤의 도구 하나 (토큰을 받는 엔진만) */
  @Put(':tool/token')
  async saveToken(
    @CurrentActor() actor: Actor,
    @Param('tool') tool: string,
    @Body() body: unknown,
  ): Promise<AiToolView> {
    return (await this.service.saveToken(actor, AiTokenInput.from(body, tool))).view(new Date());
  }

  /** 맡긴 연결 확인 */
  @HttpCode(200)
  @Post(':tool/test')
  async test(@CurrentActor() actor: Actor, @Param('tool') tool: string): Promise<AiTestView> {
    return (await this.service.test(actor, AiToolInput.from(tool))).testView();
  }

  /**
   * 웹 로그인 시작 (tool: 엔진 목록의 이름). 러너가 로그인 명령을 대신 돌린다. 취소는 POST /api/tasks/:id/cancel.
   * 시작한(또는 이미 진행 중인) 웹 로그인을 돌려준다. 단계와 주소는 GET /api/ai의 signin으로 본다
   */
  @HttpCode(200)
  @Post(':tool/signin')
  async startSignin(
    @CurrentActor() actor: Actor,
    @Param('tool') tool: string,
  ): Promise<AiTestView> {
    return (await this.service.startSignin(actor, AiToolInput.from(tool))).testView();
  }

  /** 브라우저에 나온 코드 붙여 넣기 (코드를 붙여 넣는 엔진만): { taskId, code } */
  @HttpCode(200)
  @Post(':tool/signin/code')
  async submitSigninCode(
    @CurrentActor() actor: Actor,
    @Param('tool') tool: string,
    @Body() body: unknown,
  ): Promise<AiTestView> {
    return (
      await this.service.submitSigninCode(actor, AiSigninCodeInput.from(body, tool))
    ).testView();
  }
}
