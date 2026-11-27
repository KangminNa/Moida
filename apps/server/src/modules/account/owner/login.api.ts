import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, Res } from '@nestjs/common';
import {
  type Actor,
  Cookies,
  CurrentActor,
  type HttpRequest,
  type HttpResponse,
} from '../../platform';
import { WebSession } from './owner';
import { ChangePasswordInput, LoginInput, RenameOwnerInput, SessionIdInput } from './owner.input';
import { OwnerQuery } from './owner.query';
import { OwnerService } from './owner.service';
import {
  LoggedInView,
  LoggedOutView,
  type OwnerView,
  PasswordChangedView,
  SessionsEndedView,
  type WebSessionListView,
} from './owner.view';

// 주인 로그인 (아이디·비밀번호). 로그인 쿠키는 httpOnly라 웹 화면의 스크립트가 읽을 수 없다.
@Controller('api/auth')
export class LoginController {
  constructor(
    private readonly owners: OwnerQuery,
    private readonly service: OwnerService,
  ) {}

  @HttpCode(200)
  @Post('login')
  async login(
    @Body() body: unknown,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<LoggedInView> {
    const session = await this.service.login(
      LoginInput.from(body),
      req.ip ?? '',
      String(req.headers['user-agent'] ?? ''),
    );
    Cookies.set(res, req, WebSession.COOKIE, session.token ?? '', WebSession.COOKIE_SECONDS);
    return new LoggedInView();
  }

  /** 로그인한 주인. 관리 화면 위쪽에 보인다 */
  @Get('me')
  me(@CurrentActor() actor: Actor): Promise<OwnerView> {
    return this.owners.me(actor);
  }

  /** 화면에 보일 이름 고치기 */
  @Put('me/profile')
  async rename(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<OwnerView> {
    return (await this.service.rename(actor, RenameOwnerInput.from(body))).view();
  }

  @HttpCode(200)
  @Post('logout')
  async logout(
    @CurrentActor() actor: Actor,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<LoggedOutView> {
    await this.service.logout(
      actor,
      Cookies.read(req, WebSession.COOKIE),
      req.ip ?? '',
      String(req.headers['user-agent'] ?? ''),
    );
    Cookies.clear(res, req, WebSession.COOKIE);
    return new LoggedOutView();
  }

  /** 끝나지 않은 로그인들과 보안 설정 값 (설정 › 보안) */
  @Get('sessions')
  sessions(@CurrentActor() actor: Actor, @Req() req: HttpRequest): Promise<WebSessionListView> {
    return this.owners.sessions(actor, Cookies.read(req, WebSession.COOKIE));
  }

  /** 다른 곳의 로그인 하나를 끝낸다 */
  @HttpCode(200)
  @Post('sessions/:id/end')
  async endSession(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Req() req: HttpRequest,
  ): Promise<SessionsEndedView> {
    await this.service.endSession(
      actor,
      Cookies.read(req, WebSession.COOKIE),
      SessionIdInput.from(id),
    );
    return new SessionsEndedView();
  }

  /** 지금 로그인 말고 모두 끝낸다 */
  @HttpCode(200)
  @Post('sessions/end-others')
  async endOthers(
    @CurrentActor() actor: Actor,
    @Req() req: HttpRequest,
  ): Promise<SessionsEndedView> {
    await this.service.endOtherSessions(actor, Cookies.read(req, WebSession.COOKIE));
    return new SessionsEndedView();
  }

  @Put('password')
  async password(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<PasswordChangedView> {
    await this.service.changePassword(
      actor,
      Cookies.read(req, WebSession.COOKIE),
      ChangePasswordInput.from(body),
    );
    return new PasswordChangedView();
  }
}
