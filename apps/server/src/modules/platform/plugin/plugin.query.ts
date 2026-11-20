import { Injectable } from '@nestjs/common';
import { type Actor, SettingActor } from '../base/actor';
import { BaseQuery } from '../base/base-query';
import { Database } from '../base/database';
import { NotFound } from '../base/errors';
import type { SettingChangeInput } from '../setting/setting-change.input';
import { PluginRepository } from './plugin.repository';
import {
  PluginActionView,
  PluginConfigListView,
  PluginConfigView,
  PluginListView,
  PluginSettingsView,
  PluginSettingView,
  PluginSummaryListView,
  PluginSummaryView,
  PluginValuesView,
  PluginView,
} from './plugin.view';
import { PluginManifest } from './plugin-manifest';
import { PluginRegistry } from './plugin-registry';
import { PluginState } from './plugin-state';

// 플러그인 목록과 설정. 켜짐·설정은 매번 DB에서 읽는다 (다른 곳에서 바꿔도 바로 보이게).
@Injectable()
export class PluginQuery extends BaseQuery {
  constructor(
    db: Database,
    private readonly registry: PluginRegistry,
  ) {
    super(db);
  }

  /**
   * 주인과 서버 자신에게는 들어 있는 플러그인 전부와 관리 정보(설정 칸·권한·관리 동작),
   * 그 밖의 요청자(방문자, REST의 기기 토큰)에게는 동작 중인 것의 이름과 화면 자리만
   */
  async list(actor: Actor): Promise<PluginListView | PluginSummaryListView> {
    const states = new Map((await new PluginRepository(this.sql).all()).map((s) => [s.name, s]));
    const installed = this.registry.installed();
    if (actor.canManage())
      return new PluginListView(installed.map((m) => this.view(m, states.get(m.name) ?? null)));
    const active = installed.filter((m) => this.registry.isRunning(m, states.get(m.name) ?? null));
    return new PluginSummaryListView(active.map((m) => PluginQuery.summary(m)));
  }

  async publicSettings(_actor: Actor, name: string): Promise<PluginSettingsView> {
    const manifest = this.registry.manifest(name);
    const states = await new PluginRepository(this.sql).all();
    const state = states.find((s) => s.name === name);
    if (!manifest || !state?.isActiveFor(manifest)) {
      throw new NotFound(`켜지 않은 플러그인이에요: ${name}`);
    }
    return new PluginSettingsView(
      name,
      state.publicValues(manifest),
      state.missingRequired(manifest).length === 0,
    );
  }

  /** 대화로 바꾸는 플러그인 설정 (2026-11-15 D, get_settings plugins). 확인을 거친 제안자만 */
  async settingsFor(actor: Actor): Promise<PluginConfigListView> {
    SettingActor.spaceOf(actor);
    const states = new Map((await new PluginRepository(this.sql).all()).map((s) => [s.name, s]));
    return new PluginConfigListView(
      this.registry.installed().map((m) => PluginQuery.config(m, states.get(m.name) ?? null)),
    );
  }

  /** 제안한 플러그인의 비밀이 아닌 칸의 지금 값 */
  async settingNow(actor: Actor, change: SettingChangeInput): Promise<PluginValuesView> {
    SettingActor.spaceOf(actor);
    const name = String(change.targetName);
    const manifest = this.registry.manifest(name);
    if (!manifest) throw new NotFound(`설치되지 않은 플러그인이에요: ${name}`);
    const states = await new PluginRepository(this.sql).all();
    const state = states.find((s) => s.name === name) ?? PluginState.open(manifest);
    return new PluginValuesView(state.plainValues(manifest));
  }

  private static config(m: PluginManifest, state: PluginState | null): PluginConfigView {
    const values = state?.plainValues(m) ?? {};
    return new PluginConfigView(
      m.name,
      state?.isActiveFor(m) ?? false,
      m.settings.map((spec) => ({
        key: spec.key,
        label: spec.label,
        type: spec.type,
        options: spec.options,
        value: spec.isSecret ? null : (values[spec.key] ?? spec.defaultValue),
        set: state?.hasValue(spec.key) ?? false,
      })),
    );
  }

  private static summary(m: PluginManifest): PluginSummaryView {
    return new PluginSummaryView(m.name, m.version, m.description, [...m.webSlots.keys()]);
  }

  private view(m: PluginManifest, state: PluginState | null): PluginView {
    const settings = m.settings.map((spec) => {
      const stored = state?.storedSetting(spec.key) ?? null;
      return new PluginSettingView(
        spec.key,
        spec.label,
        spec.type,
        spec.required,
        spec.help,
        spec.options,
        spec.isSecret ? null : (stored?.value ?? null),
        stored !== null,
      );
    });
    return new PluginView(
      PluginQuery.summary(m),
      state?.enabled ?? false,
      this.registry.isRunning(m, state),
      state?.enabled ? this.registry.problem(m.name) : null,
      [...m.uses],
      [...m.uses].map((u) => PluginManifest.describeUse(u)),
      state?.enabled ? m.needsGrant(new Set(state.grantedUses)) : [],
      state ? state.missingRequired(m) : m.settings.filter((s) => s.required).map((s) => s.key),
      settings,
      this.registry
        .actions()
        .filter((a) => a.plugin === m.name)
        .map((a) => new PluginActionView(a.name, a.action.label)),
    );
  }
}
