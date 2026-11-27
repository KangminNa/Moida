import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  type Actor,
  Cookies,
  CurrentActor,
  type HttpRequest,
  type HttpResponse,
} from '../../platform';
import { MemberGuard } from '../guard/member.guard';
import { MemberQuery } from '../member/member.query';
import type { AccountSelfView, MemberMeView } from '../member/member.view';
import { LoginInput, SharedPlace } from './account.input';
import { AccountService } from './account.service';
import { AccountSession } from './account-session';

// 앱 없는 로그인 (2026-11-27): 공통 앱 도메인(CAIRN_APPS_URL)의 /_/login 화면이 부른다. 그 도메인에서만 열린다 (기본 도메인 ·
// 앱마다의 도메인은 404, SharedPlace). 쿠키 하나를 그 도메인의 모든 앱이 함께 써서, 여기서 로그인하면 모든 앱에서 로그인돼 있다.
// 쓰기는 앱의 회원 API와 같은 세 겹(cross-site 403 · Origin · 쿠키가 있으면 X-Cairn-CSRF)을 MemberGuard가 본다
//   GET  api/store/me       { account, member: null, csrf } (쿠키가 없으면 모두 null)
//   POST api/store/login    { login: 메일이나 아이디, password } → 200 계정 (규칙 · 시도 제한은 앱의 로그인과 같다)
//   POST api/store/logout   그 도메인의 로그인 끝내기 (204)
@Controller('api/store')
@UseGuards(MemberGuard)
export class StoreSessionController {
  constructor(
    private readonly accounts: AccountService,
    private readonly query: MemberQuery,
  ) {}

  @Get('me')
  me(@CurrentActor() actor: Actor, @Req() req: HttpRequest): Promise<MemberMeView> {
    return this.query.sharedMe(
      actor,
      SharedPlace.from(req),
      Cookies.read(req, AccountSession.COOKIE),
    );
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<AccountSelfView> {
    const account = await this.accounts.sharedLogin(
      actor,
      SharedPlace.from(req),
      LoginInput.from(body),
    );
    const token = account.startedSession?.token ?? '';
    Cookies.set(res, req, AccountSession.COOKIE, token, AccountSession.COOKIE_SECONDS);
    return account.view();
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<void> {
    SharedPlace.from(req);
    await this.accounts.logout(Cookies.read(req, AccountSession.COOKIE));
    Cookies.clear(res, req, AccountSession.COOKIE);
  }
}
