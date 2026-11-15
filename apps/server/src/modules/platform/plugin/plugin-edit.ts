import type { Sql } from '../base/database';
import { NotFound, RuleViolation } from '../base/errors';
import type { SecretBox } from '../base/secret-box';
import type { SettingShape } from '../setting/setting.view';
import type { SettingChangeInput } from '../setting/setting-change.input';
import { PluginRepository } from './plugin.repository';
import type { PluginManifest } from './plugin-manifest';
import type { PluginRegistry } from './plugin-registry';
import { PluginState } from './plugin-state';

/**
 * 플러그인 설정 바꾸기 한 번을 부르는 쪽의 트랜잭션에서 (2026-11-15 D, task의 AgentEdit과 같은 모양).
 * 설정 바꾸기 제안의 미리 해 보기와 승인 뒤 적용이 같은 줄을 지난다 (값의 규칙은 관리 화면의 저장과 같은 PluginState.set).
 * 켜진 플러그인의 비밀이 아닌 칸만: 비밀값은 대화(AI)를 거치지 않고, 켜기 · 끄기는 확장 지점 허락이라 화면에서만.
 * 플러그인 설정은 version이 없어 제안 때 본 값과 지금 값이 같은지로 낡음을 본다. 저장은 부르는 쪽이 정한다
 */
export class PluginEdit {
  /** 대화로 바꾸는 플러그인 설정 (get_settings plugins · propose_setting plugin). 바깥으로 보내는 곳이 많아 모든 줄이 굵다 */
  static readonly SETTING: SettingShape = {
    setting: 'plugin',
    list: 'plugins',
    ops: ['edit'],
    fields: null,
    target: 'name',
    versioned: false,
    grants: 'all',
  };

  constructor(
    private readonly tx: Sql,
    private readonly registry: PluginRegistry,
    private readonly box: SecretBox,
  ) {}

  /** 칸의 값은 글자로 (true · 3 같은 값도 관리 화면처럼 글자로 받는다). null은 비우기 */
  static normalize(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        key,
        value === null ? '' : typeof value === 'object' ? value : String(value),
      ]),
    );
  }

  /** 바뀐 플러그인 (아직 저장 전) */
  async apply(change: SettingChangeInput): Promise<PluginState> {
    const name = String(change.targetName);
    const manifest = this.registry.manifest(name);
    if (!manifest) throw new NotFound(`설치되지 않은 플러그인이에요: ${name}`);
    const state = (await new PluginRepository(this.tx).lock(name)) ?? PluginState.open(manifest);
    if (!state.isActiveFor(manifest))
      throw new RuleViolation(`켜진 플러그인의 설정만 바꿔요 (켜기는 화면에서): ${name}`);
    change.assertUnchanged(state.plainValues(manifest));
    for (const [key, value] of Object.entries(change.body)) this.set(manifest, state, key, value);
    return state;
  }

  private set(manifest: PluginManifest, state: PluginState, key: string, value: unknown): void {
    const spec = manifest.setting(key);
    if (!spec) throw new RuleViolation(`${manifest.name}에 없는 설정이에요: ${key}`);
    if (spec.isSecret)
      throw new RuleViolation(`${spec.label}: 비밀값은 대화로 바꾸지 않아요 (화면에서 넣어요)`);
    if (typeof value !== 'string') throw new RuleViolation(`${spec.label}: 글자로 넣어 주세요`);
    state.set(spec, value.trim(), this.box);
  }
}
