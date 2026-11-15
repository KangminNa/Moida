import { Actor, Forbidden } from '../../platform';

/** 바뀐 칸 한 줄 (결재의 payload.changes, 화면이 "칸: 전 → 후"로 그린다). grant는 권한을 더하는 줄 */
export type SettingChangeLine = { field: string; before: unknown; after: unknown; grant: boolean };

// 설정 바꾸기 제안 (2026-11-15 C, 기획서 결정): 무엇을 바꿀 수 있는지(설정 · 동작 · 칸), 바뀐 점, 누가 읽고 제안하는지.
// 바꾸는 규칙 자체는 엔티티(Agent · Schedule)가 AgentEdit · ScheduleEdit을 거쳐 본다 (관리자의 고치기와 같은 줄).
// 지우기는 C에 없다 (화면에서만)
export class SettingChanges {
  static readonly AGENT = 'agent';
  static readonly SCHEDULE = 'schedule';
  static readonly CREATE = 'create';
  /** 설정마다 할 수 있는 동작 */
  static readonly OPS: Readonly<Record<string, readonly string[]>> = {
    agent: ['create', 'edit', 'pause', 'resume'],
    schedule: ['create', 'edit'],
  };
  /** 칸을 받지 않는 동작 (바뀌는 것은 상태 하나) */
  static readonly SWITCHES: readonly string[] = ['pause', 'resume'];
  /** 제안할 수 있는 칸 (get_settings의 이름과 같다. 관리자 REST의 칸을 snake_case로) */
  static readonly FIELDS: Readonly<Record<string, readonly string[]>> = {
    agent: [
      'name',
      'role',
      'tool',
      'model',
      'effort',
      'scopes',
      'approval_actions',
      'reports_to',
      'reviewer_id',
      'runner_id',
      'external_tools',
      'monthly_limit',
      'five_hour_limit',
      'plan_stop_percent',
    ],
    schedule: [
      'title',
      'agent_id',
      'enabled',
      'mode',
      'at_time',
      'weekdays',
      'every_hours',
      'time_zone',
      'instruction',
      'goal_id',
      'page_id',
      'destination',
      'deliver',
      'rules',
      'trigger',
      'after_id',
      'daily_max',
    ],
  };
  /** 권한을 더하는 칸: 화면이 굵게, "권한"으로 보인다 */
  private static readonly GRANTS: readonly string[] = [
    'scopes',
    'approval_actions',
    'external_tools',
    'runner_id',
  ];

  /** 바뀐 칸만 (지금 값과 함께). 만들기는 지금 값이 없다 (before null) */
  static diff(
    before: Readonly<Record<string, unknown>> | null,
    fields: Readonly<Record<string, unknown>>,
  ): SettingChangeLine[] {
    return Object.entries(fields).flatMap(([field, after]) => {
      const was = before ? (before[field] ?? null) : null;
      if (before && JSON.stringify(was) === JSON.stringify(after ?? null)) return [];
      return [
        {
          field,
          before: was,
          after: after ?? null,
          grant: SettingChanges.grants(field, was, after),
        },
      ];
    });
  }

  /** 멈추기 · 재개의 바뀐 점 (상태 하나) */
  static switched(
    before: Readonly<Record<string, unknown>> | null,
    op: string,
  ): SettingChangeLine[] {
    const after = op === 'pause' ? 'paused' : 'active';
    const was = before?.status ?? null;
    return was === after ? [] : [{ field: 'status', before: was, after, grant: false }];
  }

  /** 바깥으로 나가는 길(브라우저 · 커넥터)이 있는 에이전트는 설정을 읽거나 제안하지 못한다: 지시 · 레시피 글에 비공개가 섞인다 */
  static assertInside(scopes: readonly string[], externalTools: readonly string[]): void {
    if (scopes.includes(Actor.BROWSE) || externalTools.length > 0)
      throw new Forbidden(
        Actor.BROWSE,
        '브라우저 · 커넥터 에이전트는 설정을 읽거나 바꾸자고 하지 못해요',
      );
  }

  private static grants(field: string, before: unknown, after: unknown): boolean {
    if (!SettingChanges.GRANTS.includes(field) || after === null || after === undefined)
      return false;
    if (!Array.isArray(after)) return after !== before;
    const had: readonly unknown[] = Array.isArray(before) ? before : [];
    return after.some((v) => !had.includes(v));
  }
}
