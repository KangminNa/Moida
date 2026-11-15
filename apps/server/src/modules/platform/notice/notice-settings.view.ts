import type { NoticeSettingRow } from '../platform.tables';

// 알림 설정의 읽기 모양 (7단계). 웹이 `import type`으로 가져온다. 주인만 본다.

/** 알림 설정과 등록한 종류마다 지금의 경로. 시각은 API에서 "09:00", 칸은 하루 중 분(540) */
export class NoticeSettingsView {
  constructor(
    private readonly row: Readonly<NoticeSettingRow>,
    private readonly kinds: readonly {
      kind: string;
      label: string;
      severity: string;
      route: string;
    }[],
  ) {}

  toJSON() {
    const r = this.row;
    return {
      digest: r.digest,
      digestTime: NoticeSettingsView.time(r.digest_minute),
      quietStart: r.quiet_start === null ? null : NoticeSettingsView.time(r.quiet_start),
      quietEnd: r.quiet_end === null ? null : NoticeSettingsView.time(r.quiet_end),
      timeZone: r.time_zone,
      kinds: this.kinds,
      version: r.version,
    };
  }

  private static time(minute: number): string {
    return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  }
}

/**
 * 대화로 바꾸는 알림 설정 (2026-11-15 D, get_settings notices). MCP라 snake_case, 칸 이름은 propose_setting의 fields와 같다.
 * routes는 종류마다 지금 가는 곳 (정하지 않았으면 등급의 기본), kinds는 바꿀 수 있는 종류와 이름
 */
export class NoticeSettingView {
  constructor(
    private readonly row: Readonly<NoticeSettingRow>,
    private readonly kinds: readonly {
      kind: string;
      label: string;
      severity: string;
      route: string;
    }[],
  ) {}

  toJSON() {
    const r = this.row;
    const time = (m: number | null) =>
      m === null
        ? null
        : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return {
      version: r.version,
      digest: r.digest,
      digest_time: time(r.digest_minute),
      quiet_start: time(r.quiet_start),
      quiet_end: time(r.quiet_end),
      time_zone: r.time_zone,
      routes: Object.fromEntries(this.kinds.map((k) => [k.kind, k.route])),
      kinds: this.kinds.map((k) => ({ kind: k.kind, label: k.label, severity: k.severity })),
    };
  }
}
