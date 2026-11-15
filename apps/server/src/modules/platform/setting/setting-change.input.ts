import { BaseRequest } from '../base/base-request';
import { Conflict } from '../base/errors';
import { type SettingChangeLine, SettingKinds } from './setting-kinds';

const VERSION_MAX = 2_147_483_647;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 설정 바꾸기 하나 (2026-11-15 D): 제안의 미리 해 보기와 승인 뒤 적용이 같은 모양을 받는다.
 * 제안은 task가 propose_setting에서 만들고(from), 적용은 승인 이벤트(task.approval.granted)의 결재 칸과 payload에서 읽는다(approved).
 * body는 바꿀 값 (받은 칸 그대로, 에이전트 · 스케줄은 관리자 REST 본문), changes는 서버가 본 바뀐 줄 (바뀌기 전 값 비교에 쓴다)
 */
export class SettingChangeInput extends BaseRequest {
  /** 공간에 하나 · 이름형 · 만들기의 결재 대상 종류 (대상 id는 공간) */
  static readonly SPACE_TARGET = 'space';

  private constructor(
    /** 만들기의 requestId: 제안은 request_id, 승인 뒤 적용은 결재 id */
    readonly key: string,
    readonly setting: string,
    readonly op: string,
    /** 고치기의 대상 (만들기 · 공간에 하나 · 이름형이면 null) */
    readonly targetId: string | null,
    /** 이름형 대상 (플러그인) */
    readonly targetName: string | null,
    /** 본 버전 (만들기 · version이 없는 설정은 0) */
    readonly version: number,
    readonly body: Readonly<Record<string, unknown>>,
    readonly changes: readonly SettingChangeLine[],
    /** 승인한 사람 (승인 뒤 적용만) */
    readonly decidedBy: string | null = null,
  ) {
    super();
  }

  /** 제안 (task가 propose_setting의 입력과 서버가 본 바뀐 줄로 만든다. 모양은 task의 입력이 이미 보았다) */
  static proposed(raw: {
    key: string;
    setting: string;
    op: string;
    targetId: string | null;
    targetName: string | null;
    version: number;
    body: Readonly<Record<string, unknown>>;
    changes: readonly SettingChangeLine[];
  }): SettingChangeInput {
    return new SettingChangeInput(
      raw.key,
      raw.setting,
      raw.op,
      raw.targetId,
      raw.targetName,
      raw.version,
      raw.body,
      raw.changes,
    );
  }

  /** 설정 바꾸기의 승인인가 (다른 동작의 승인은 넘어간다) */
  static carries(data: Readonly<Record<string, unknown>>): boolean {
    return data.action === SettingKinds.ACTION && typeof payloadOf(data).setting === 'string';
  }

  /** 승인 이벤트의 설정 바꾸기: 결재 칸(대상 · 판)과 payload (서버가 제안 때 미리 해 보고 적은 값) */
  static approved(data: Readonly<Record<string, unknown>>): SettingChangeInput {
    const payload = payloadOf(data);
    return BaseRequest.read({ ...data, ...payload }, (f) => {
      if (!isRecord(payload.body)) f.reject('payload.body', '객체여야 해요');
      const lines = Array.isArray(payload.changes) ? payload.changes.filter(isRecord) : [];
      const targetId = f.uuid('targetId');
      return new SettingChangeInput(
        f.uuid('approvalId'),
        f.text('setting', 40),
        f.text('op', 20),
        data.targetKind === SettingChangeInput.SPACE_TARGET ? null : targetId,
        f.optionalText('target_name', 64),
        f.integer('targetVersion', 0, VERSION_MAX),
        isRecord(payload.body) ? payload.body : {},
        lines.map((l) => ({
          field: String(l.field),
          ...(typeof l.label === 'string' ? { label: l.label } : {}),
          before: l.before ?? null,
          after: l.after ?? null,
          grant: l.grant === true,
        })),
        f.uuid('decidedBy'),
      );
    });
  }

  /** 결재에 싣는 값 (approvals.payload, 승인 이벤트에도 실린다) */
  payload(): Record<string, unknown> {
    return {
      setting: this.setting,
      op: this.op,
      body: this.body,
      changes: this.changes,
      ...(this.targetName === null ? {} : { target_name: this.targetName }),
    };
  }

  /**
   * version이 없는 설정의 낡음: 지금 값이 제안 때 본 값(바뀐 줄의 before)과 다르면 Conflict.
   * 목록형 칸의 줄("칸.키")은 그 칸의 키를 본다
   */
  assertUnchanged(now: Readonly<Record<string, unknown>> | null): void {
    for (const line of this.changes) {
      const was = valueAt(now ?? {}, line.field);
      if (JSON.stringify(was ?? null) !== JSON.stringify(line.before ?? null))
        throw new Conflict(`제안한 뒤 바뀐 칸이에요: ${line.field}`);
    }
  }
}

function payloadOf(data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return isRecord(data.payload) ? data.payload : {};
}

/** "칸" 또는 목록형 칸의 "칸.키" (키에 점이 있어도 첫 점에서 나눈다) */
function valueAt(values: Readonly<Record<string, unknown>>, field: string): unknown {
  if (field in values) return values[field];
  const dot = field.indexOf('.');
  if (dot < 0) return null;
  const map = values[field.slice(0, dot)];
  return isRecord(map) ? map[field.slice(dot + 1)] : null;
}
