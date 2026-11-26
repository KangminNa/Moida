import { Body, Controller, Get, HttpCode, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { type Actor, Cookies, CurrentActor, type HttpRequest } from '../../platform';
import { AccountSession } from '../account/account-session';
import { MemberGuard } from '../guard/member.guard';
import { EnterInput, LeaveInput, MemberPlace, RenameInput } from './member.input';
import { MemberQuery } from './member.query';
import { MemberService } from './member.service';
import type { MemberMeView, MemberSelfView } from './member.view';

// 앱의 회원 (스토어 3-1, 스토어 계정 2026-11-26). 앱 도메인에서만 열린다
// (HostGate가 /api/community 아래에서 admin/을 뺀 경로를 쓰기까지 연다). 가입 · 로그인 · 비밀번호 · 계정은 AccountController.
//   GET   api/community/me             이 브라우저가 누구인가 { account, member, csrf } (account: 로그인한 계정, member: 이 앱의 회원)
//   POST  api/community/enter          이 앱에 참여 { nickname, termsVersion?, privacyVersion?, appTermsVersion?, appPrivacyVersion? }
//   PATCH api/community/me             닉네임 바꾸기
//   POST  api/community/me/leave       이 앱에서 나가기 { password }: 이 앱의 닉네임을 지우고 글은 "탈퇴한 회원"으로 남는다 (계정 · 로그인은 그대로)
// 가입 · 로그인 · 참여 화면은 웹의 고정 화면이다 (3-2)
@Controller('api/community')
@UseGuards(MemberGuard)
export class MemberController {
  constructor(
    private readonly query: MemberQuery,
    private readonly members: MemberService,
  ) {}

  @Get('me')
  me(@CurrentActor() actor: Actor, @Req() req: HttpRequest): Promise<MemberMeView> {
    return this.query.me(actor, MemberPlace.from(req), Cookies.read(req, AccountSession.COOKIE));
  }

  @Post('enter')
  @HttpCode(201)
  async enter(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<MemberSelfView> {
    return (await this.members.enter(actor, MemberPlace.from(req), EnterInput.from(body))).view();
  }

  @Patch('me')
  async rename(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<MemberSelfView> {
    return (await this.members.rename(actor, MemberPlace.from(req), RenameInput.from(body))).view();
  }

  @Post('me/leave')
  @HttpCode(204)
  async leave(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<void> {
    await this.members.leave(actor, MemberPlace.from(req), LeaveInput.from(body));
  }
}
