import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SettingKinds } from '../platform';
import { AppDataQuery } from './data/app-data.query';
import { AppDataService } from './data/app-data.service';

// community가 가진 것 중 대화로 바꾸는 것 (앱 플랫폼, 스토어 12.4): 앱의 표에 줄 넣기 (레슨 · 단어 같은 내용).
// 방문자에게 보이는 내용을 바꾸므로 일꾼이 바로 넣지 않고 제안으로 올린다 (원칙 7). 만들기만 있다: 고치기 · 지우기는 관리자가 한다
@Injectable()
export class CommunitySettings implements OnModuleInit {
  constructor(
    private readonly kinds: SettingKinds,
    private readonly query: AppDataQuery,
    private readonly data: AppDataService,
  ) {}

  onModuleInit(): void {
    this.kinds.register({
      ...AppDataService.SETTING,
      read: (a) => this.query.settings(a),
      current: async () => null,
      rehearse: (a, c) => this.data.rehearseSetting(a, c),
      apply: (a, c) => this.data.applySetting(a, c),
    });
  }
}
