import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type Actor,
  Cookies,
  CurrentActor,
  DomainError,
  type HttpRequest,
  type HttpResponse,
  SecretBox,
} from '../../platform';
import { MemberGuard } from '../guard/member.guard';
import { JoinTicket } from './join-ticket';
import {
  JoinInput,
  MemberCallbackInput,
  MemberPlace,
  MemberStartInput,
  RenameInput,
} from './member.input';
import { MemberQuery } from './member.query';
import { MemberService } from './member.service';
import type { MemberLoginMethodListView, MemberMeView, MemberSelfView } from './member.view';
import { MemberSession } from './member-session';

// 커뮤니티 회원 (스토어 3-1). 앱 도메인에서만 열린다 (HostGate가 /api/community 아래에서 admin/을 뺀 경로를 쓰기까지 연다).
//   GET   api/community/me                       이 브라우저가 누구인가 + 쓰기 확인 값(csrf)
//   GET   api/community/login/methods            회원 로그인 버튼들
//   GET   api/community/login/:method/start      소셜 로그인 시작 (302)
//   GET   api/community/login/:method/callback   그 서비스가 돌려보내는 곳 (302: 돌아갈 곳 · 가입 화면 · 로그인 화면)
//   POST  api/community/join                     가입 (가입 표 쿠키)
//   POST  api/community/logout                   로그아웃
//   PATCH api/community/me                       닉네임 바꾸기
// 가입 · 로그인 화면은 웹의 고정 화면이다 (3-2): 앱 도메인의 /_/join · /_/login
@Controller('api/community')
@UseGuards(MemberGuard)
export class MemberController {
  static readonly JOIN_PATH = '/_/join';
  static readonly LOGIN_PATH = '/_/login';

  constructor(
    private readonly query: MemberQuery,
    private readonly members: MemberService,
    private readonly box: SecretBox,
  ) {}

  @Get('me')
  me(@CurrentActor() actor: Actor, @Req() req: HttpRequest): Promise<MemberMeView> {
    return this.query.me(
      actor,
      MemberPlace.from(req),
      Cookies.read(req, MemberSession.COOKIE),
      Cookies.read(req, JoinTicket.COOKIE),
    );
  }

  @Get('login/methods')
  methods(
    @CurrentActor() actor: Actor,
    @Req() req: HttpRequest,
  ): Promise<MemberLoginMethodListView> {
    return this.query.methods(actor, MemberPlace.from(req));
  }

  @Get('login/:method/start')
  async start(
    @CurrentActor() actor: Actor,
    @Param('method') method: string,
    @Req() req: HttpRequest,
    @Res() res: HttpResponse,
  ): Promise<void> {
    const view = await this.query.start(
      actor,
      MemberPlace.from(req),
      MemberStartInput.from(method, req.query),
    );
    Cookies.set(res, req, MemberCallbackInput.COOKIE, view.cookie, MemberCallbackInput.SECONDS);
    res.redirect(302, view.url);
  }

  /** 브라우저가 직접 여는 주소라 실패도 JSON 대신 로그인 화면으로 돌려보낸다 (?error=) */
  @Get('login/:method/callback')
  async callback(
    @CurrentActor() actor: Actor,
    @Param('method') method: string,
    @Req() req: HttpRequest,
    @Res() res: HttpResponse,
  ): Promise<void> {
    const place = MemberPlace.from(req);
    const cookie = Cookies.read(req, MemberCallbackInput.COOKIE);
    Cookies.clear(res, MemberCallbackInput.COOKIE);
    try {
      const request = MemberCallbackInput.from(method, req.query, cookie, this.box, place.appId);
      const done = await this.members.signIn(actor, place, request);
      if (done instanceof JoinTicket) {
        Cookies.set(res, req, JoinTicket.COOKIE, done.cookie, JoinTicket.SECONDS);
        res.redirect(
          302,
          `${MemberController.JOIN_PATH}?return=${encodeURIComponent(done.returnTo)}`,
        );
        return;
      }
      Cookies.set(res, req, MemberSession.COOKIE, done.token ?? '', MemberSession.COOKIE_SECONDS);
      Cookies.clear(res, JoinTicket.COOKIE);
      res.redirect(302, request.returnTo);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      res.redirect(
        302,
        `${MemberController.LOGIN_PATH}?error=${encodeURIComponent(error.message)}`,
      );
    }
  }

  @Post('join')
  @HttpCode(201)
  async join(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<MemberSelfView> {
    const place = MemberPlace.from(req);
    const ticket = JoinTicket.open(this.box, Cookies.read(req, JoinTicket.COOKIE), place.appId);
    const member = await this.members.join(actor, place, JoinInput.from(body), ticket);
    const token = member.startedSession?.token ?? '';
    Cookies.set(res, req, MemberSession.COOKIE, token, MemberSession.COOKIE_SECONDS);
    Cookies.clear(res, JoinTicket.COOKIE);
    return member.view();
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
}
