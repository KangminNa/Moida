import { Actor, Forbidden, type SettingChangeLine, type SettingShape } from '../../platform';

type Values = Readonly<Record<string, unknown>>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** snake_case 칸 이름 → 관리자 REST 본문의 이름 (reports_to → reportsTo, at_time → atTime) */
const restName = (field: string) => field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

// 설정 바꾸기 제안 (2026-11-15 C · D, 기획서 결정): 바뀐 점과 굵게 보일 줄, 누가 읽고 제안하는지.
// 무엇을 바꿀 수 있는지(설정 · 동작 · 칸)는 설정을 가진 모듈의 Edit이 SETTING으로 갖고 platform SettingKinds에 등록한다.
// 바꾸는 규칙 자체는 엔티티가 그 Edit을 거쳐 본다 (관리자의 고치기와 같은 줄). 지우기는 없다 (화면에서만)
export class SettingChanges {
  /** task가 가진 설정(에이전트 · 스케줄 · 목표)을 적용한 결과 (task.setting.changed { approvalId, outcome, error? }) */
  static readonly TOPIC = 'task.setting.changed';
  static readonly CREATE = 'create';
  /** 칸을 받지 않는 동작 (바뀌는 것은 상태 하나) */
  static readonly SWITCHES: readonly string[] = ['pause', 'resume'];

  /**
   * 바뀐 칸만 (지금 값과 함께). 만들기는 지금 값이 없다 (before null, 모든 칸이 줄).
   * 목록형 칸(shape.maps)은 키마다 "칸.키" 한 줄. label은 화면이 미리 모르는 이름 (labelOf)
   */
  static diff(
    shape: SettingShape,
    now: Values | null,
    fields: Values,
    labelOf: (field: string) => string | null = () => null,
  ): SettingChangeLine[] {
    const line = (path: string, field: string, was: unknown, after: unknown) => {
      if (now && JSON.stringify(was ?? null) === JSON.stringify(after ?? null)) return [];
      const label = labelOf(path);
      return [
        {
          field: path,
          ...(label ? { label } : {}),
          before: was ?? null,
          after: after ?? null,
          grant: SettingChanges.grants(shape, field, was ?? null, after),
        },
      ];
    };
    return Object.entries(fields).flatMap(([field, after]) => {
      if (!shape.maps?.includes(field) || !isRecord(after))
        return line(field, field, now ? now[field] : null, after);
      const was = now && isRecord(now[field]) ? now[field] : {};
      return Object.entries(after).flatMap(([key, v]) =>
        line(`${field}.${key}`, field, now ? was[key] : null, v),
      );
    });
  }

  /** 멈추기 · 재개의 바뀐 점 (상태 하나) */
  static switched(before: Values | null, op: string): SettingChangeLine[] {
    const after = op === 'pause' ? 'paused' : 'active';
    const was = before?.status ?? null;
    return was === after ? [] : [{ field: 'status', before: was, after, grant: false }];
  }

  /** 관리자 REST 본문 (에이전트: 보낸 칸만). C에서 결재에 실은 모양이라 그대로 둔다 */
  static restBody(fields: Values): Record<string, unknown> {
    return Object.fromEntries(Object.entries(fields).map(([k, v]) => [restName(k), v]));
  }

  /** 관리자 REST 본문 (스케줄: 고치기는 설정 전부를 받으므로 지금 값 위에 바꿀 칸을 얹는다) */
  static restBodyOver(names: readonly string[], fields: Values, now: Values | null) {
    const base = now ? Object.fromEntries(names.map((k) => [k, now[k] ?? null] as const)) : {};
    return SettingChanges.restBody({ ...base, ...fields });
  }

  /** 바깥으로 나가는 길(브라우저 · 커넥터)이 있는 에이전트는 설정을 읽거나 제안하지 못한다: 지시 · 레시피 글에 비공개가 섞인다 */
  static assertInside(scopes: readonly string[], externalTools: readonly string[]): void {
    if (scopes.includes(Actor.BROWSE) || externalTools.length > 0)
      throw new Forbidden(
        Actor.BROWSE,
        '브라우저 · 커넥터 에이전트는 설정을 읽거나 바꾸자고 하지 못해요',
      );
  }

  /** 굵게 보일 줄: 권한을 더하는 칸이 새 값을 얻거나(목록은 새 항목), 모든 줄이 굵은 설정(플러그인)에서 바뀐 줄 */
  private static grants(shape: SettingShape, field: string, before: unknown, after: unknown) {
    if (after === null || after === undefined) return false;
    if (shape.grants === 'all') return true;
    if (!shape.grants.includes(field)) return false;
    if (!Array.isArray(after)) return after !== before;
    const had: readonly unknown[] = Array.isArray(before) ? before : [];
    return after.some((v) => !had.includes(v));
  }
}
