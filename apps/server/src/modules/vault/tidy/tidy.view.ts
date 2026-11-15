import type { TidySettingRow } from '../vault.tables';

// 세션 정리의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).

/** 자동 정리 설정. 행이 없으면 꺼짐이고 version은 0이다 */
export class TidySettingsView {
  constructor(
    private readonly row: Readonly<
      Pick<TidySettingRow, 'auto_tidy' | 'version'> &
        Partial<Pick<TidySettingRow, 'cadence' | 'daily_at'>>
    >,
  ) {}

  toJSON() {
    return {
      autoTidy: this.row.auto_tidy,
      /** save(저장할 때마다) · daily(하루 한 번 몰아서, 2차 7단계) */
      cadence: this.row.cadence ?? 'daily',
      /** 하루 한 번의 마지막 차례. 아직 없으면 null */
      dailyAt: this.row.daily_at?.toISOString() ?? null,
      version: this.row.version,
    };
  }
}

/** 쌓인 세션 정리를 요청한 결과 */
/** 대화로 바꾸는 세션 정리 (2026-11-15 D, get_settings tidy). MCP라 snake_case */
export class TidySettingView {
  constructor(
    private readonly row: Readonly<
      Pick<TidySettingRow, 'auto_tidy' | 'version'> & Partial<Pick<TidySettingRow, 'cadence'>>
    >,
  ) {}

  toJSON() {
    return {
      version: this.row.version,
      auto_tidy: this.row.auto_tidy,
      cadence: this.row.cadence ?? 'daily',
    };
  }
}

export class TidyBacklogView {
  constructor(
    private readonly requested: number,
    private readonly remaining: number,
  ) {}

  toJSON() {
    return { requested: this.requested, remaining: this.remaining };
  }
}
