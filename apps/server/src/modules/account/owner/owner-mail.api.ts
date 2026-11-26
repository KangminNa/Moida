import { Body, Controller, HttpCode, Post, Put, Req } from '@nestjs/common';
import { type Actor, Cookies, CurrentActor, type HttpRequest } from '../../platform';
import { WebSession } from './owner';
import { OwnerCodeInput, OwnerEmailInput, OwnerResetInput } from './owner.input';
import type { OwnerView } from './owner.view';
import { OwnerMailService } from './owner-mail.service';

// 관리자 비밀번호를 잊었을 때 (2026-11-26, 메일 인증코드). 로그인 화면의 "비밀번호를 잊었어요"가 부른다.
//   POST api/auth/password/code   { email }                   인증코드 메일 (답은 늘 204)
//   POST api/auth/password/reset  { email, code, password }   새 비밀번호 (모든 로그인이 끝난다)
//   POST api/auth/email/code      { email }                   로그인 메일로 쓸 주소 확인 코드 (관리자만)
//   PUT  api/auth/email           { email, code, password }   로그인 메일 바꾸기 (아이디로 만든 계정을 메일로 옮기기)
@Controller('api/auth')
export class OwnerMailController {
  constructor(private readonly service: OwnerMailService) {}

  @HttpCode(204)
  @Post('password/code')
  async code(@Body() body: unknown, @Req() req: HttpRequest): Promise<void> {
    await this.service.sendCode(OwnerCodeInput.from(body), req.ip ?? '');
  }

  @HttpCode(204)
  @Post('password/reset')
  async reset(@Body() body: unknown, @Req() req: HttpRequest): Promise<void> {
    await this.service.resetPassword(OwnerResetInput.from(body), req.ip ?? '');
  }

  @HttpCode(204)
  @Post('email/code')
  async emailCode(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<void> {
    await this.service.sendEmailCode(actor, OwnerCodeInput.from(body), req.ip ?? '');
  }

  @Put('email')
  async email(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<OwnerView> {
    const owner = await this.service.changeEmail(
      actor,
      Cookies.read(req, WebSession.COOKIE),
      OwnerEmailInput.from(body),
      req.ip ?? '',
    );
    return owner.view();
  }
}
