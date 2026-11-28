import { Body, Controller, HttpCode, Patch, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import {
  type Actor,
  Cookies,
  CurrentActor,
  type HttpRequest,
  type HttpResponse,
} from '../../platform';
import { MemberGuard } from '../guard/member.guard';
import { LeaveInput } from '../member/member.input';
import type { AccountSelfView } from '../member/member.view';
import {
  CodeRequestInput,
  NewsInput,
  PasswordInput,
  ResetPasswordInput,
  SharedPlace,
} from './account.input';
import { AccountService } from './account.service';
import { AccountMailService } from './account-mail.service';
import { AccountSession } from './account-session';

// 앱 없는 계정 일 (2026-11-28): 공통 앱 도메인(CAIRN_APPS_URL)의 /_/reset · /_/me 화면이 부른다. 그 도메인에서만 열린다
// (기본 도메인 · 앱마다의 도메인은 404, SharedPlace). 규칙은 앱의 같은 API(api/community/…)와 같고, 앱 이름 자리에 사이트가 온다.
// 로그인이 필요한 것은 그 도메인의 앱 없는 요청자(MemberGuard의 MemberActor, appId null)로, 쓰기의 세 겹도 MemberGuard가 본다
//   POST  api/store/password/code    비밀번호 다시 정하기 인증코드 { email } (답은 늘 204)
//   POST  api/store/password/reset   새 비밀번호 { email, code, password } (모든 앱의 로그인이 끝난다)
//   PATCH api/store/me/password      비밀번호 바꾸기 { current, next } (다른 로그인은 모두 끝난다)
//   PUT   api/store/account/news     소식 메일 받기 { version, agreed }
//   POST  api/store/account/leave    계정 탈퇴 { password }: 모든 앱에서 나가고 개인정보를 지우고 모든 로그인을 끝낸다
@Controller('api/store')
@UseGuards(MemberGuard)
export class StoreAccountController {
  constructor(
    private readonly accounts: AccountService,
    private readonly mail: AccountMailService,
  ) {}

  @Post('password/code')
  @HttpCode(204)
  async passwordCode(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<void> {
    await this.mail.sendResetCode(actor, SharedPlace.from(req), CodeRequestInput.from(body));
  }

  @Post('password/reset')
  @HttpCode(204)
  async passwordReset(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<void> {
    await this.mail.resetPassword(actor, SharedPlace.from(req), ResetPasswordInput.from(body));
  }

  @Patch('me/password')
  @HttpCode(204)
  async password(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<void> {
    await this.accounts.changePassword(
      actor,
      SharedPlace.from(req),
      PasswordInput.from(body),
      Cookies.read(req, AccountSession.COOKIE),
    );
  }

  @Put('account/news')
  async news(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<AccountSelfView> {
    const place = SharedPlace.from(req);
    return (await this.accounts.setNews(actor, place, NewsInput.from(body))).view();
  }

  @Post('account/leave')
  @HttpCode(204)
  async leave(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<void> {
    await this.accounts.leave(actor, SharedPlace.from(req), LeaveInput.from(body));
    Cookies.clear(res, req, AccountSession.COOKIE);
  }
}
