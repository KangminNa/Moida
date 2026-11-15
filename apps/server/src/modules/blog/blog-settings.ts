import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SettingKinds } from '../platform';
import { MenuQuery } from './menu/menu.query';
import { MenuService } from './menu/menu.service';
import { MenuEdit } from './menu/menu-edit';

// blog가 가진 설정 중 대화로 바꾸는 것 (2026-11-15 D): 블로그 메뉴 (이름 · 주소 · 편집 방침 · 운영 팀 · RSS · 순서).
// 글 · 페이지 · 호는 설정이 아니라 작업과 발행 승인으로 다룬다
@Injectable()
export class BlogSettings implements OnModuleInit {
  constructor(
    private readonly kinds: SettingKinds,
    private readonly query: MenuQuery,
    private readonly menus: MenuService,
  ) {}

  onModuleInit(): void {
    this.kinds.register({
      ...MenuEdit.SETTING,
      read: (a) => this.query.settings(a),
      current: async (a, c) => (await this.query.settingNow(a, c))?.toJSON() ?? null,
      rehearse: (a, c) => this.menus.rehearseSetting(a, c),
      apply: (a, c) => this.menus.applySetting(a, c),
    });
  }
}
