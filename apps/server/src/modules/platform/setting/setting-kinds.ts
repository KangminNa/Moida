import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';
import type { ToolAnswer } from '../base/base-tool';
import type { SettingShape } from './setting.view';
import type { SettingChangeInput } from './setting-change.input';

/**
 * 바뀐 칸 한 줄 (결재의 payload.changes, 화면이 "칸: 전 → 후"로 그린다). 목록형 칸(maps)은 키마다 "칸.키".
 * grant는 굵게 보일 줄 (권한을 더하거나 바깥으로 가는 곳을 바꾼다), label은 화면이 미리 모르는 이름 (알림 종류 · 플러그인 칸)
 */
export type SettingChangeLine = {
  field: string;
  label?: string;
  before: unknown;
  after: unknown;
  grant: boolean;
};

/** 설정 하나 (모듈이 시작할 때 SettingKinds에 등록한다). actor는 읽기 · 미리 해 보기는 SettingActor, 적용은 ApprovedActor */
export interface SettingKind extends SettingShape {
  /** get_settings의 답 (View) */
  read(actor: Actor): Promise<ToolAnswer>;
  /** 대상의 지금 값 (get_settings 한 줄과 같은 칸). 만들기면 null, 없으면 NotFound */
  current(
    actor: Actor,
    change: SettingChangeInput,
  ): Promise<Readonly<Record<string, unknown>> | null>;
  /** 저장하지 않고 관리자의 고치기와 같은 줄을 지나 본다 (어긋나면 오류) */
  rehearse(actor: Actor, change: SettingChangeInput): Promise<void>;
  /** 승인 뒤 적용: 결재마다 한 번(SettingOutcome), 결과는 <모듈>.setting.changed */
  apply(actor: Actor, change: SettingChangeInput): Promise<void>;
  /** 받은 칸의 값을 그 설정의 모양으로 (바뀐 줄을 만들기 전에. 플러그인: 값은 글자로) */
  normalize?(fields: Readonly<Record<string, unknown>>): Record<string, unknown>;
  /** 결재에 실을 본문 (없으면 받은 칸 그대로). 에이전트 · 스케줄(C)은 관리자 REST 본문 */
  bodyOf?(
    fields: Readonly<Record<string, unknown>>,
    now: Readonly<Record<string, unknown>> | null,
  ): Record<string, unknown>;
  /** 줄의 화면 이름 (화면이 미리 모르는 것만: 알림 종류 · 플러그인 칸). 없으면 null */
  labelOf?(field: string, change: SettingChangeInput): string | null;
}

// 대화로 바꿀 수 있는 설정 (2026-11-15 D): 설정을 가진 모듈이 시작할 때 하나씩 등록하고, task(get_settings · propose_setting ·
// 승인 뒤 적용)는 무엇이 있는지 모른 채 여기서 찾는다 (ActionChecks · Library와 같은 방식). 등록하지 않은 설정은 바꾸지 못한다
@Injectable()
export class SettingKinds {
  /** 설정 바꾸기 결재의 동작 (task가 올리고, 승인 뒤 설정을 가진 모듈이 적용한다) */
  static readonly ACTION = 'task.setting.change';
  private readonly kinds = new Map<string, SettingKind>();

  register(kind: SettingKind): void {
    if (this.kinds.has(kind.setting) || this.listed(kind.list))
      throw new Error(`이미 등록한 설정이에요: ${kind.setting} (${kind.list})`);
    this.kinds.set(kind.setting, kind);
  }

  /** propose_setting의 setting으로 */
  of(setting: string): SettingKind | null {
    return this.kinds.get(setting) ?? null;
  }

  /** get_settings의 kind로 */
  listed(list: string): SettingKind | null {
    return [...this.kinds.values()].find((k) => k.list === list) ?? null;
  }

  /** 등록한 차례대로 */
  all(): readonly SettingKind[] {
    return [...this.kinds.values()];
  }
}
