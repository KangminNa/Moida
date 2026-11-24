import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  type Actor,
  Cookies,
  CurrentActor,
  type HttpRequest,
  type HttpResponse,
} from '../../platform';
import { MemberGuard } from '../guard/member.guard';
import type { Member } from './member';
import {
  JoinInput,
  LeaveInput,
  LoginInput,
  MemberPlace,
  PasswordInput,
  RenameInput,
} from './member.input';
import { MemberQuery } from './member.query';
import { MemberService } from './member.service';
import type { MemberMeView, MemberSelfView } from './member.view';
import { MemberSession } from './member-session';

// 커뮤니티 회원 (스토어 3-1, 아이디 · 비밀번호 가입 2026-11-19). 앱 도메인에서만 열린다
// (HostGate가 /api/community 아래에서 admin/을 뺀 경로를 쓰기까지 연다).
//   GET   api/community/me             이 브라우저가 누구인가 + 쓰기 확인 값(csrf)
//   POST  api/community/join           가입 (바로 로그인)
//   POST  api/community/login          로그인
//   POST  api/community/logout         로그아웃
//   PATCH api/community/me             닉네임 바꾸기
//   PATCH api/community/me/password    비밀번호 바꾸기 (다른 로그인은 모두 끝난다)
//   POST  api/community/me/leave       탈퇴 { password }: 개인정보를 지우고 모든 로그인을 끝낸다 (3-4, 글은 "탈퇴한 회원"으로 남는다)
//   가입은 { …, termsVersion, privacyVersion }: 지금 공개된 약관 버전이어야 한다 (3-4, 아니면 409)
// 가입 · 로그인 화면은 웹의 고정 화면이다 (3-2)
@Controller('api/community')
@UseGuards(MemberGuard)
export class MemberController {
  constructor(
    private readonly query: MemberQuery,
    private readonly members: MemberService,
  ) {}

  @Get('me')
  me(@CurrentActor() actor: Actor, @Req() req: HttpRequest): Promise<MemberMeView> {
    return this.query.me(actor, MemberPlace.from(req), Cookies.read(req, MemberSession.COOKIE));
  }

  @Post('join')
  @HttpCode(201)
  async join(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<MemberSelfView> {
    const member = await this.members.join(actor, MemberPlace.from(req), JoinInput.from(body));
    return MemberController.signedIn(member, req, res);
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<MemberSelfView> {
    const member = await this.members.login(actor, MemberPlace.from(req), LoginInput.from(body));
    return MemberController.signedIn(member, req, res);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<void> {
    MemberPlace.from(req);
    await this.members.logout(Cookies.read(req, MemberSession.COOKIE));
    Cookies.clear(res, MemberSession.COOKIE);
  }

  @Patch('me')
  async rename(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<MemberSelfView> {
    return (await this.members.rename(actor, MemberPlace.from(req), RenameInput.from(body))).view();
  }

  @Patch('me/password')
  @HttpCode(204)
  async password(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<void> {
    await this.members.changePassword(
      actor,
      MemberPlace.from(req),
      PasswordInput.from(body),
      Cookies.read(req, MemberSession.COOKIE),
    );
  }

  @Post('me/leave')
  @HttpCode(204)
  async leave(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<void> {
    await this.members.leave(actor, MemberPlace.from(req), LeaveInput.from(body));
    Cookies.clear(res, MemberSession.COOKIE);
  }

  /** 가입 · 로그인한 브라우저에 새 회원 쿠키 (Domain 없이 이 앱 도메인에만) */
  private static signedIn(member: Member, req: HttpRequest, res: HttpResponse): MemberSelfView {
    const token = member.startedSession?.token ?? '';
    Cookies.set(res, req, MemberSession.COOKIE, token, MemberSession.COOKIE_SECONDS);
    return member.view();
  }
}
