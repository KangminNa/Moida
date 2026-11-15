import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SettingKinds, SettingOneView } from '../platform';
import { SpaceQuery } from './space/space.query';
import { SpaceService } from './space/space.service';
import { SpaceEdit } from './space/space-edit';

// account가 가진 설정 중 대화로 바꾸는 것 (2026-11-15 D): 블로그 이름 · 소개.
// 계정 · 보안 · 기기 · 사이트 주소 · 앱 연결 허용은 로그인과 바깥 연결이 걸려 화면에서만 바꾼다
@Injectable()
export class AccountSettings implements OnModuleInit {
  constructor(
    private readonly kinds: SettingKinds,
    private readonly query: SpaceQuery,
    private readonly spaces: SpaceService,
  ) {}

  onModuleInit(): void {
    this.kinds.register({
      ...SpaceEdit.SETTING,
      read: async (a) => new SettingOneView('site', await this.query.setting(a)),
      current: async (a) => (await this.query.setting(a)).toJSON(),
      rehearse: (a, c) => this.spaces.rehearseSetting(a, c),
      apply: (a, c) => this.spaces.applySetting(a, c),
    });
  }
}
