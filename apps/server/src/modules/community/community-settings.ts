import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SettingKinds } from '../platform';
import { AppDataQuery } from './data/app-data.query';
import { AppDataService } from './data/app-data.service';
import { ModerationService } from './moderation/moderation.service';
import { ModerationChange } from './moderation/moderation-change';
import { ReviewQuery } from './moderation/review.query';
import { TermsQuery } from './terms/terms.query';
import { TermsService } from './terms/terms.service';
import { TermsChange } from './terms/terms-change';

// community가 가진 것 중 대화로 바꾸는 것: 앱의 표에 줄 넣기 (레슨 · 단어 같은 내용, 앱 플랫폼 스토어 12.4)와
// 신고 검토의 결정 (글 · 댓글의 가림 · 되돌림 · 내림, 회원 차단 · 풀기, 2026-11-24 스토어 3-3), 약관의 새 버전 (스토어 3-4).
// 방문자에게 보이는 내용 · 회원을 바꾸므로 일꾼이 바로 하지 않고 제안으로 올려 관리자가 승인한다 (원칙 7 · 10)
@Injectable()
export class CommunitySettings implements OnModuleInit {
  constructor(
    private readonly kinds: SettingKinds,
    private readonly query: AppDataQuery,
    private readonly data: AppDataService,
    private readonly review: ReviewQuery,
    private readonly moderation: ModerationService,
    private readonly termsQuery: TermsQuery,
    private readonly terms: TermsService,
  ) {}

  onModuleInit(): void {
    this.kinds.register({
      ...AppDataService.SETTING,
      read: (a) => this.query.settings(a),
      current: async () => null,
      rehearse: (a, c) => this.data.rehearseSetting(a, c),
      apply: (a, c) => this.data.applySetting(a, c),
    });
    this.kinds.register({
      ...ModerationChange.SETTING,
      read: (a) => this.review.queue(a),
      current: (a, c) => this.review.settingNow(a, c),
      rehearse: (a, c) => this.moderation.rehearseSetting(a, c),
      apply: (a, c) => this.moderation.applySetting(a, c),
      normalize: (fields) => ModerationChange.normalize(fields),
    });
    this.kinds.register({
      ...TermsChange.SETTING,
      read: (a) => this.termsQuery.settings(a),
      current: (a, c) => this.termsQuery.settingNow(a, c),
      rehearse: (a, c) => this.terms.rehearseSetting(a, c),
      apply: (a, c) => this.terms.applySetting(a, c),
    });
  }
}
