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
  UseGuards,
} from '@nestjs/common';
import {
  type Actor,
  Cookies,
  CurrentActor,
  type HttpRequest,
  type HttpResponse,
} from '../../platform';
import { MemberGuard } from '../guard/member.guard';
import { LeaveInput, MemberPlace } from '../member/member.input';
import { type AccountSelfView, MemberMeView } from '../member/member.view';
import type { AdminPageView } from '../moderation/moderation.view';
import type { Account } from './account';
import {
  AccountListInput,
  CodeRequestInput,
  EmailInput,
  JoinInput,
  LoginIdInput,
  LoginInput,
  PasswordInput,
  ResetPasswordInput,
  SuspendInput,
} from './account.input';
import { AccountQuery } from './account.query';
import { AccountService } from './account.service';
import type { AccountAdminView, AccountSuspendedView } from './account.view';
import { AccountMailService } from './account-mail.service';
import { AccountSession } from './account-session';

// 스토어 계정 (2026-11-26): 공간(스토어)에 계정 하나, 로그인은 앱 도메인마다. 앱 도메인에서만 열린다.
//   POST  api/community/join/code          가입 인증코드를 메일로 { email } (답은 늘 204: 가입한 주소인지 드러내지 않는다)
//   POST  api/community/join               가입 { email, code, loginId, password, nickname, ageConfirmed, termsVersion, privacyVersion, appTermsVersion?, appPrivacyVersion? }
//                                          계정을 만들고 이 앱에 참여해 바로 로그인 (약관 버전이 지금 것이 아니면 409)
//   POST  api/community/login              로그인 { login: 메일이나 아이디, password } (이 앱 도메인에만, 참여 전이면 member는 null)
//   POST  api/community/password/code      비밀번호 다시 정하기 인증코드 { email } (답은 늘 204)
//   POST  api/community/password/reset     새 비밀번호 { email, code, password } (모든 앱의 로그인이 끝난다)
//   POST  api/community/logout             로그아웃 (이 앱 도메인의 로그인)
//   PATCH api/community/me/password        비밀번호 바꾸기 { current, next } (다른 로그인은 모두 끝난다)
//   PUT   api/community/account/login-id   아이디 정하기 { version, loginId } (아이디가 없는 옛 계정만)
//   POST  api/community/account/email/code 메일 등록 인증코드 { email } (메일이 없는 옛 계정만, 답은 늘 204)
//   PUT   api/community/account/email      메일 등록 { email, code }
//   POST  api/community/account/leave      계정 탈퇴 { password }: 모든 앱에서 나가고 개인정보를 지우고 모든 로그인을 끝낸다
@Controller('api/community')
@UseGuards(MemberGuard)
export class AccountController {
  constructor(
    private readonly accounts: AccountService,
    private readonly mail: AccountMailService,
  ) {}

  @Post('join/code')
  @HttpCode(204)
  async joinCode(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<void> {
    await this.mail.sendJoinCode(actor, MemberPlace.from(req), CodeRequestInput.from(body));
  }

  @Post('join')
  @HttpCode(201)
  async join(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<MemberMeView> {
    const [account, member] = await this.mail.join(
      actor,
      MemberPlace.from(req),
      JoinInput.from(body),
    );
    AccountController.signedIn(account, req, res);
    return new MemberMeView(account.view(), member.view(), null);
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<AccountSelfView> {
    const account = await this.accounts.login(actor, MemberPlace.from(req), LoginInput.from(body));
    AccountController.signedIn(account, req, res);
    return account.view();
  }

  @Post('password/code')
  @HttpCode(204)
  async passwordCode(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<void> {
    await this.mail.sendResetCode(actor, MemberPlace.from(req), CodeRequestInput.from(body));
  }

  @Post('password/reset')
  @HttpCode(204)
  async passwordReset(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<void> {
    await this.mail.resetPassword(actor, MemberPlace.from(req), ResetPasswordInput.from(body));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<void> {
    MemberPlace.from(req);
    await this.accounts.logout(Cookies.read(req, AccountSession.COOKIE));
    Cookies.clear(res, AccountSession.COOKIE);
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
      MemberPlace.from(req),
      PasswordInput.from(body),
      Cookies.read(req, AccountSession.COOKIE),
    );
  }

  @Put('account/login-id')
  async loginId(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<AccountSelfView> {
    const place = MemberPlace.from(req);
    return (await this.accounts.setLoginId(actor, place, LoginIdInput.from(body))).view();
  }

  @Post('account/email/code')
  @HttpCode(204)
  async emailCode(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<void> {
    await this.mail.sendEmailCode(actor, MemberPlace.from(req), CodeRequestInput.from(body));
  }

  @Put('account/email')
  async email(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<AccountSelfView> {
    return (await this.mail.setEmail(actor, MemberPlace.from(req), EmailInput.from(body))).view();
  }

  @Post('account/leave')
  @HttpCode(204)
  async leave(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<void> {
    await this.accounts.leave(actor, MemberPlace.from(req), LeaveInput.from(body));
    Cookies.clear(res, AccountSession.COOKIE);
  }

  /** 가입 · 로그인한 브라우저에 새 회원 쿠키 (Domain 없이 이 앱 도메인에만) */
  private static signedIn(account: Account, req: HttpRequest, res: HttpResponse): void {
    const token = account.startedSession?.token ?? '';
    Cookies.set(res, req, AccountSession.COOKIE, token, AccountSession.COOKIE_SECONDS);
  }
}

// 스토어 계정 관리 (2026-11-26, 설정 › 회원 계정). 관리자만, 기본 도메인에서만 (admin/은 앱 도메인에 열리지 않는다).
//   GET  api/community/admin/accounts                 계정 목록 (최근 가입부터 50개, ?cursor=)
//   POST api/community/admin/accounts/:id/suspend     계정 정지 { version, until? }: 모든 앱에서 로그인을 막고 지금 로그인을 끝낸다
//   POST api/community/admin/accounts/:id/unsuspend   정지 풀기 { version }
@Controller('api/community/admin/accounts')
export class AccountAdminController {
  constructor(
    private readonly query: AccountQuery,
    private readonly accounts: AccountService,
  ) {}

  @Get()
  list(
    @CurrentActor() actor: Actor,
    @Query() query: unknown,
  ): Promise<AdminPageView<AccountAdminView>> {
    return this.query.list(actor, AccountListInput.from(query));
  }

  @Post(':id/suspend')
  @HttpCode(200)
  async suspend(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AccountSuspendedView> {
    return (await this.accounts.suspend(actor, SuspendInput.from(id, body))).suspendedView();
  }

  @Post(':id/unsuspend')
  @HttpCode(200)
  async unsuspend(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AccountSuspendedView> {
    return (await this.accounts.unsuspend(actor, SuspendInput.from(id, body))).suspendedView();
  }
}
