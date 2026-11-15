import { Injectable, type OnModuleInit } from '@nestjs/common';
import { NoticeCatalog } from '../notice/notice-catalog';
import { NoticeSettingsQuery } from '../notice/notice-settings.query';
import { NoticeSettingsService } from '../notice/notice-settings.service';
import { NoticeSettingsEdit } from '../notice/notice-settings-edit';
import { PluginQuery } from '../plugin/plugin.query';
import { PluginService } from '../plugin/plugin.service';
import { PluginEdit } from '../plugin/plugin-edit';
import { PluginRegistry } from '../plugin/plugin-registry';
import { SettingOneView } from './setting.view';
import { SettingKinds } from './setting-kinds';

// platform이 가진 설정 중 대화로 바꾸는 것 (2026-11-15 D): 알림 설정 · 플러그인 설정(켜진 것의 비밀이 아닌 칸).
// 무엇을 바꿀 수 있는지는 Edit의 SETTING, 읽기는 Query, 미리 해 보기 · 적용은 Service (관리자의 저장과 같은 규칙)
@Injectable()
export class PlatformSettings implements OnModuleInit {
  private static readonly ROUTES = 'routes.';

  constructor(
    private readonly kinds: SettingKinds,
    private readonly catalog: NoticeCatalog,
    private readonly noticeQuery: NoticeSettingsQuery,
    private readonly notices: NoticeSettingsService,
    private readonly registry: PluginRegistry,
    private readonly pluginQuery: PluginQuery,
    private readonly plugins: PluginService,
  ) {}

  onModuleInit(): void {
    this.kinds.register({
      ...NoticeSettingsEdit.SETTING,
      read: async (a) => new SettingOneView('notices', await this.noticeQuery.setting(a)),
      current: async (a) => (await this.noticeQuery.setting(a)).toJSON(),
      rehearse: (a, c) => this.notices.rehearseSetting(a, c),
      apply: (a, c) => this.notices.applySetting(a, c),
      // 경로 한 줄의 이름은 알림 종류의 이름 (승인 요청 · 작업 실패 …)
      labelOf: (field) =>
        field.startsWith(PlatformSettings.ROUTES)
          ? (this.catalog.all().find((k) => k.kind === field.slice(PlatformSettings.ROUTES.length))
              ?.label ?? null)
          : null,
    });
    this.kinds.register({
      ...PluginEdit.SETTING,
      read: (a) => this.pluginQuery.settingsFor(a),
      current: async (a, c) => (await this.pluginQuery.settingNow(a, c)).toJSON(),
      rehearse: (a, c) => this.plugins.rehearseSetting(a, c),
      apply: (a, c) => this.plugins.applySetting(a, c),
      normalize: (fields) => PluginEdit.normalize(fields),
      // 칸의 이름은 그 플러그인 목록 파일의 label
      labelOf: (field, c) =>
        this.registry.manifest(String(c.targetName))?.setting(field)?.label ?? null,
    });
  }
}
