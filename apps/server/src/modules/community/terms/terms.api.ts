import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { type Actor, CurrentActor, type HttpRequest } from '../../platform';
import { MemberGuard } from '../guard/member.guard';
import { MemberPlace } from '../member/member.input';
import { TermKindInput, TermPublishInput } from './terms.input';
import { TermsQuery } from './terms.query';
import { TermsService } from './terms.service';
import type { TermsAdminView, TermView } from './terms.view';

// 약관 (스토어 3-4).
//   GET  api/community/terms/:kind              공개된 약관 (terms · privacy). 앱 도메인에서 누구나, 없으면 404
// 회원 화면 /_/terms · /_/privacy와 가입 화면의 동의 칸이 읽는다
@Controller('api/community/terms')
@UseGuards(MemberGuard)
export class TermsController {
  constructor(private readonly query: TermsQuery) {}

  @Get(':kind')
  published(
    @CurrentActor() actor: Actor,
    @Param('kind') kind: string,
    @Req() req: HttpRequest,
  ): Promise<TermView> {
    return this.query.published(actor, MemberPlace.from(req), TermKindInput.from(kind).kind);
  }
}

// 약관 관리 (스토어 3-4). 관리자만, 기본 도메인에서만 (admin/은 앱 도메인에 열리지 않는다).
//   GET  api/community/admin/:appId/terms        이용약관 · 개인정보처리방침의 지금 버전과 초안, 가입할 수 있는지(ready)
//   POST api/community/admin/:appId/terms/:kind  { version, body } 새 버전 공개 (version은 본 버전, 처음이면 0). 그사이 바뀌었으면 409
@Controller('api/community/admin/:appId/terms')
export class TermsAdminController {
  constructor(
    private readonly query: TermsQuery,
    private readonly terms: TermsService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Param('appId') appId: string): Promise<TermsAdminView> {
    return this.query.admin(actor, appId);
  }

  @Post(':kind')
  @HttpCode(201)
  publish(
    @CurrentActor() actor: Actor,
    @Param('appId') appId: string,
    @Param('kind') kind: string,
    @Body() body: unknown,
  ): Promise<TermView> {
    return this.terms.publish(actor, TermPublishInput.from(appId, kind, body));
  }
}
