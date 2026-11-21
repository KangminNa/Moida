import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import {
  type Actor,
  CurrentActor,
  DomainError,
  Forbidden,
  type HttpRequest,
  type HttpResponse,
  VersionInput,
} from '../../platform';
import { OAuthCallbackInput } from './external-tool.input';
import type { OAuthStartView } from './external-tool.view';
import { ExternalToolOAuthService } from './external-tool-oauth.service';
import { OAuthStop } from './oauth-grant.policy';

// OAuth 커넥터의 로그인 (C1, 관리자만). Input 만들기 → Service 메서드 하나 → View 또는 화면으로 돌려보내기.
//   POST api/external-tools/:id/oauth/start { version } → { url }: 브라우저가 같은 탭으로 연다
//   GET  api/external-tools/oauth/callback?code&state[&iss]: 로그인 서버가 돌려보내는 곳. 브라우저가 연 주소라 결과를
//        커넥터 화면으로 돌려보낸다: ?connected=<id> · ?oauth_error=<까닭>(state · denied · token · changed, 문구는 화면이 고른다).
//        관리자가 아니면 돌려보내지 않고 403
@Controller('api/external-tools')
export class ExternalToolOAuthController {
  /** 돌려보낼 화면 (웹의 커넥터 메뉴) */
  static readonly SCREEN = '/admin/external-tools';

  constructor(private readonly oauth: ExternalToolOAuthService) {}

  @Post(':id/oauth/start')
  @HttpCode(200)
  start(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<OAuthStartView> {
    return this.oauth.start(actor, VersionInput.from(id, body));
  }

  @Get('oauth/callback')
  async callback(
    @CurrentActor() actor: Actor,
    @Req() req: HttpRequest,
    @Res() res: HttpResponse,
  ): Promise<void> {
    const screen = ExternalToolOAuthController.SCREEN;
    try {
      const id = await this.oauth.finish(actor, OAuthCallbackInput.from(req.query));
      res.redirect(302, `${screen}?connected=${id}`);
    } catch (error) {
      if (!(error instanceof DomainError) || error instanceof Forbidden) throw error;
      res.redirect(302, `${screen}?oauth_error=${OAuthStop.reasonOf(error)}`);
    }
  }
}
