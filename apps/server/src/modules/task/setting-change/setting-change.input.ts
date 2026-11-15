import { BaseRequest, type RequestFields } from '../../platform';
import { Approval } from '../approval/approval';
import type { ApprovalRow } from '../task.tables';
import { SettingChanges } from './setting-change.policy';

// 설정 바꾸기 (2026-11-15 C) 입력의 모양. 칸 값의 뜻은 관리자 REST의 입력(AgentEdit · ScheduleEdit이 다시 읽는다)과 엔티티가 본다.

const VERSION_MAX = 2_147_483_647;

/** snake_case 칸 이름 → 관리자 REST 본문의 이름 (reports_to → reportsTo, at_time → atTime) */
const restName = (field: string) => field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** MCP get_settings { kind: team · schedules } */
export class GetSettingsInput extends BaseRequest {
  static readonly TEAM = 'team';
  static readonly SCHEDULES = 'schedules';

  private constructor(readonly kind: string) {
    super();
  }

  static from(raw: unknown): GetSettingsInput {
    return BaseRequest.read(raw, (f) => {
      const kind = f.text('kind', 20);
      if (kind !== GetSettingsInput.TEAM && kind !== GetSettingsInput.SCHEDULES)
        f.reject('kind', 'team · schedules 중 하나예요');
      return new GetSettingsInput(kind);
    });
  }
}

/** MCP propose_setting { request_id, setting, op, target_id?, version?, fields?, note }. 같은 request_id는 처음 결재 */
export class ProposeSettingInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly setting: string,
    readonly op: string,
    /** 고치기 · 멈추기 · 재개의 대상 (만들기면 null) */
    readonly targetId: string | null,
    /** 대상의 본 버전 (get_settings의 version) */
    readonly version: number | null,
    /** 바꿀 칸 (get_settings와 같은 이름, 보낸 칸만) */
    readonly fields: Readonly<Record<string, unknown>>,
    readonly note: string | null,
  ) {
    super();
  }

  static from(raw: unknown): ProposeSettingInput {
    const body = (raw ?? {}) as Record<string, unknown>;
    return BaseRequest.read(body, (f) => {
      const requestId = f.uuid('request_id');
      const setting = f.text('setting', 20);
      const op = f.text('op', 20);
      const ops = SettingChanges.OPS[setting];
      if (!ops) f.reject('setting', 'agent · schedule 중 하나예요');
      else if (!ops.includes(op)) f.reject('op', `${ops.join(' · ')} 중 하나예요`);
      const creating = op === SettingChanges.CREATE;
      return new ProposeSettingInput(
        requestId,
        setting,
        op,
        creating ? null : f.uuid('target_id'),
        creating ? null : f.integer('version', 1, VERSION_MAX),
        fieldsOf(f, body.fields, SettingChanges.FIELDS[setting] ?? [], op),
        f.optionalText('note', 4000),
      );
    });
  }

  /** 멈추기 · 재개 (칸이 없다) */
  get switching(): boolean {
    return SettingChanges.SWITCHES.includes(this.op);
  }

  /**
   * 관리자 REST 본문 (AgentEdit · ScheduleEdit.apply가 받는다). 스케줄 고치기는 설정 전부를 받으므로
   * 지금 값(before) 위에 바꿀 칸을 얹는다
   */
  bodyOver(before: Readonly<Record<string, unknown>> | null): Record<string, unknown> {
    const base =
      this.setting === SettingChanges.SCHEDULE && before
        ? Object.fromEntries(
            (SettingChanges.FIELDS.schedule ?? []).map((k) => [k, before[k] ?? null] as const),
          )
        : {};
    return Object.fromEntries(
      Object.entries({ ...base, ...this.fields }).map(([k, v]) => [restName(k), v]),
    );
  }

  /** 올릴 결재의 칸: 동작 task.setting.change, 대상은 고칠 것 (만들기면 공간, 판 0) */
  approvalFields(
    spaceId: string,
  ): Pick<ApprovalRow, 'action' | 'target_kind' | 'target_id' | 'target_version' | 'note'> {
    return {
      action: Approval.SETTING_CHANGE,
      target_kind: this.targetId === null ? 'space' : this.setting,
      target_id: this.targetId ?? spaceId,
      target_version: this.version ?? 0,
      note: this.note,
    };
  }
}

/** 바꿀 칸: 객체, 이 설정의 칸만. 멈추기 · 재개는 칸을 받지 않는다 */
function fieldsOf(
  f: RequestFields,
  value: unknown,
  allowed: readonly string[],
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
  const unknown = Object.keys(fields).filter((k) => !allowed.includes(k));
  if (unknown.length > 0)
    f.reject('fields', `모르는 칸이에요: ${unknown.join(', ')} (받는 칸: ${allowed.join(' · ')})`);
  else if (Object.keys(fields).length === 0) f.reject('fields', '바꿀 칸이 있어야 해요');
  return fields;
}

/** 승인 이벤트(task.approval.granted)의 설정 바꾸기: 결재의 payload (서버가 제안 때 미리 해 보고 적은 값) */
export class ApprovedSettingInput extends BaseRequest {
  private constructor(
    readonly approvalId: string,
    readonly decidedBy: string,
    readonly op: string,
    readonly targetId: string,
    readonly targetVersion: number,
    /** 관리자 REST와 같은 본문 */
    readonly body: Readonly<Record<string, unknown>>,
  ) {
    super();
  }

  /** 이 설정의 바꾸기인가 (다른 동작 · 다른 설정의 승인은 넘어간다) */
  static carries(data: Readonly<Record<string, unknown>>, setting: string): boolean {
    const payload = data.payload as { setting?: unknown } | null | undefined;
    return data.action === Approval.SETTING_CHANGE && payload?.setting === setting;
  }

  static from(data: Readonly<Record<string, unknown>>): ApprovedSettingInput {
    const payload = (data.payload ?? {}) as Record<string, unknown>;
    const body = payload.body;
    return BaseRequest.read({ ...data, op: payload.op }, (f) => {
      if (typeof body !== 'object' || body === null || Array.isArray(body))
        f.reject('payload.body', '객체여야 해요');
      return new ApprovedSettingInput(
        f.uuid('approvalId'),
        f.uuid('decidedBy'),
        f.text('op', 20),
        f.uuid('targetId'),
        f.integer('targetVersion', 0, VERSION_MAX),
        (body ?? {}) as Record<string, unknown>,
      );
    });
  }
}
