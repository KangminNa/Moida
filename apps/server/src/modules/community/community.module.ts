import { Module, type OnModuleInit } from '@nestjs/common';
import { HostGate, PasswordHasher } from '../platform';
import { MemberGuard } from './guard/member.guard';
import { MemberController } from './member/member.api';
import { MemberQuery } from './member/member.query';
import { MemberService } from './member/member.service';

// 커뮤니티 (스토어 3단계, docs/스토어.md 11장): 앱 도메인의 회원 · 글 · 댓글 · 신고. 관리자 계정(account)과 표 · 쿠키 · 권한을 나눈다 (원칙 10).
// 다른 모듈과는 Lookups 'community-app'(blog)과 이벤트로만 잇는다: 나중에 같은 코드에서 진입점만 다른 컨테이너로 뗄 수 있게 (11.2)
@Module({
  providers: [
    { provide: PasswordHasher, useValue: new PasswordHasher() },
    MemberQuery,
    MemberService,
    MemberGuard,
  ],
  controllers: [MemberController],
})
export class CommunityModule implements OnModuleInit {
  /** 앱 도메인에서 여는 경로: /api/community 아래, 관리자 경로(admin/)만 빼고 쓰기까지 */
  static readonly MEMBER_PATHS = /^\/api\/community\/(?!admin(?:\/|$))/;

  constructor(private readonly gate: HostGate) {}

  onModuleInit(): void {
    this.gate.openPaths([CommunityModule.MEMBER_PATHS], true);
  }
}
