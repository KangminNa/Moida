import {
  BaseRequest,
  type RequestFields,
  SettingChangeInput,
  type SettingChangeLine,
  type SettingKinds,
} from '../../platform';
import { Approval } from '../approval/approval';
import type { ApprovalRow } from '../task.tables';
import { SettingChanges } from './setting-change.policy';

// 설정 바꾸기 (2026-11-15 C · D) 입력의 모양. 설정 · 동작 · 칸은 platform SettingKinds에 등록한 설정의 모양(SettingShape)으로 본다.
// 칸 값의 뜻은 그 설정을 가진 모듈의 Edit과 엔티티가 본다 (미리 해 보기).

const VERSION_MAX = 2_147_483_647;

/** MCP get_settings { kind? }. kind가 없으면 바꿀 수 있는 설정의 목록 */
export class GetSettingsInput extends BaseRequest {
  private constructor(readonly kind: string | null) {
    super();
  }

  static from(raw: unknown, kinds: SettingKinds): GetSettingsInput {
    return BaseRequest.read(raw ?? {}, (f) => {
      const kind = f.optionalText('kind', 20);
      if (kind !== null && !kinds.listed(kind))
        f.reject(
          'kind',
          `${kinds
            .all()
            .map((k) => k.list)
            .join(' · ')} 중 하나예요`,
        );
      return new GetSettingsInput(kind);
    });
  }
}

/** MCP propose_setting { request_id, setting, op, target_id?, target_name?, version?, fields?, note }. 같은 request_id는 처음 결재 */
export class ProposeSettingInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    /** 등록한 설정 (SettingKinds.of로 찾는다) */
    readonly setting: string,
    readonly op: string,
    /** 고치기 · 멈추기 · 재개의 대상 (만들기 · 공간에 하나 · 이름형이면 null) */
    readonly targetId: string | null,
    /** 이름형 대상 (플러그인) */
    readonly targetName: string | null,
    /** 대상의 본 버전 (get_settings의 version). 만들기 · version이 없는 설정은 0 */
    readonly version: number,
    /** 바꿀 칸 (get_settings와 같은 이름, 보낸 칸만) */
    readonly fields: Readonly<Record<string, unknown>>,
    readonly note: string | null,
  ) {
    super();
  }

  static from(raw: unknown, kinds: SettingKinds): ProposeSettingInput {
    const body = (raw ?? {}) as Record<string, unknown>;
    return BaseRequest.read(body, (f) => {
      const requestId = f.uuid('request_id');
      const setting = f.text('setting', 40);
      const op = f.text('op', 20);
      const shape = kinds.of(setting);
      if (!shape)
        f.reject(
          'setting',
          `${kinds
            .all()
            .map((k) => k.setting)
            .join(' · ')} 중 하나예요`,
        );
      else if (!shape.ops.includes(op)) f.reject('op', `${shape.ops.join(' · ')} 중 하나예요`);
      const creating = op === SettingChanges.CREATE;
      const target = shape?.target ?? 'id';
      return new ProposeSettingInput(
        requestId,
        setting,
        op,
        target === 'id' && !creating ? f.uuid('target_id') : null,
        target === 'name' ? f.text('target_name', 64) : null,
        shape?.versioned && !creating ? f.integer('version', 0, VERSION_MAX) : 0,
        fieldsOf(f, body.fields, shape?.fields ?? null, op),
        f.optionalText('note', 4000),
      );
    });
  }

  /** 멈추기 · 재개 (칸이 없다) */
  get switching(): boolean {
    return SettingChanges.SWITCHES.includes(this.op);
  }

  /** 설정을 가진 모듈이 받는 바꾸기 (미리 해 보기 · 결재의 payload). body는 결재에 실을 본문 */
  change(body: Readonly<Record<string, unknown>>, changes: readonly SettingChangeLine[]) {
    return SettingChangeInput.proposed({
      key: this.requestId,
      setting: this.setting,
      op: this.op,
      targetId: this.targetId,
      targetName: this.targetName,
      version: this.version,
      body,
      changes,
    });
  }

  /** 올릴 결재의 칸: 동작 task.setting.change, 대상은 고칠 것 (만들기 · 공간에 하나 · 이름형이면 공간) */
  approvalFields(
    spaceId: string,
  ): Pick<ApprovalRow, 'action' | 'target_kind' | 'target_id' | 'target_version' | 'note'> {
    return {
      action: Approval.SETTING_CHANGE,
      target_kind: this.targetId === null ? SettingChangeInput.SPACE_TARGET : this.setting,
      target_id: this.targetId ?? spaceId,
      target_version: this.version,
      note: this.note,
    };
  }
}

/** 바꿀 칸: 객체, 이 설정의 칸만 (allowed가 null이면 그 모듈이 미리 해 보기에서 본다). 멈추기 · 재개는 칸을 받지 않는다 */
function fieldsOf(
  f: RequestFields,
  value: unknown,
  allowed: readonly string[] | null,
  op: string,
): Record<string, unknown> {
  const switching = SettingChanges.SWITCHES.includes(op);
  if (value === undefined || value === null) {
    if (!switching) f.reject('fields', '바꿀 칸이 있어야 해요');
    return {};
  }
  if (switching) {
    f.reject('fields', '멈추기 · 재개는 칸을 받지 않아요');
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    f.reject('fields', '객체여야 해요');
    return {};
  }
  const fields = value as Record<string, unknown>;
  const unknown = allowed ? Object.keys(fields).filter((k) => !allowed.includes(k)) : [];
  if (unknown.length > 0)
    f.reject(
      'fields',
      `모르는 칸이에요: ${unknown.join(', ')} (받는 칸: ${(allowed ?? []).join(' · ')})`,
    );
  else if (Object.keys(fields).length === 0) f.reject('fields', '바꿀 칸이 있어야 해요');
  return fields;
}
