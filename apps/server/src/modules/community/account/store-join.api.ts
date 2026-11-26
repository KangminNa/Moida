import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { type Actor, CurrentActor, type HttpRequest } from '../../platform';
import type { AccountSelfView } from '../member/member.view';
import { TermKindInput } from '../terms/terms.input';
import { TermsQuery } from '../terms/terms.query';
import type { TermView } from '../terms/terms.view';
import { CodeRequestInput, StoreJoinInput, StorePlace } from './account.input';
import { StoreJoinService } from './store-join.service';

// 스토어에서 가입 (2026-11-26): 기본 도메인(스토어 첫 화면)의 가입 화면 /join이 부른다. 앱 도메인이면 404 (HostGate가 열지 않는다).
// 계정만 만들고 로그인하지 않는다: 기본 도메인은 콘솔과 같은 출처라 회원 쿠키를 두지 않는다 (로그인은 앱 도메인에서)
//   POST api/store/join/code     가입 인증코드를 메일로 { email } (답은 늘 204)
//   POST api/store/join          가입 { email, code, loginId, password, ageConfirmed, termsVersion, privacyVersion } → 201 계정 (로그인 없음)
//   GET  api/store/terms/:kind   공통 약관 (가입 화면의 동의 칸, 없으면 404)
@Controller('api/store')
export class StoreJoinController {
  constructor(
    private readonly joins: StoreJoinService,
    private readonly terms: TermsQuery,
  ) {}

  @Post('join/code')
  @HttpCode(204)
  async code(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<void> {
    await this.joins.sendCode(actor, StorePlace.from(req), CodeRequestInput.from(body));
  }

  @Post('join')
  @HttpCode(201)
  async join(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<AccountSelfView> {
    const account = await this.joins.join(actor, StorePlace.from(req), StoreJoinInput.from(body));
    return account.view();
  }

  @Get('terms/:kind')
  storeTerms(
    @CurrentActor() actor: Actor,
    @Param('kind') kind: string,
    @Req() req: HttpRequest,
  ): Promise<TermView> {
    return this.terms.storePublished(actor, StorePlace.from(req), TermKindInput.from(kind).kind);
  }
}
