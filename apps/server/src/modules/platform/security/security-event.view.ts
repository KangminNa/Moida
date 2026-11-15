import type { SecurityEventRow } from '../platform.tables';

// 보안 기록의 읽기 모양 (관리자만). 웹이 `import type`으로 가져온다.
// detail은 기록하는 쪽이 짧은 값만 넣지만, 내보낼 열쇠는 여기서 한 번 더 고른다 (새 열쇠가 저절로 나가지 않게)

/** 화면에 보이는 내용의 열쇠 */
const SHOWN = ['method', 'login', 'path', 'status', 'code', 'credential', 'device', 'reason'];

function shownDetail(detail: unknown): Record<string, string | number | boolean | null> {
  const given = (detail ?? {}) as Record<string, unknown>;
  const out: Record<string, string | number | boolean | null> = {};
  for (const key of SHOWN) {
    const value = given[key];
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
      out[key] = value as string | number | boolean | null;
  }
  return out;
}

/** 보안 기록 한 쪽 (최근부터). next는 다음 쪽 커서 */
export class SecurityEventPageView {
  constructor(
    private readonly rows: readonly SecurityEventRow[],
    private readonly next: string | null,
  ) {}

  toJSON() {
    return {
      events: this.rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        at: r.at.toISOString(),
        /** 1분 안에 같은 사건이 또 오면 합친다: 마지막 때와 횟수 */
        lastAt: r.last_at.toISOString(),
        count: r.count,
        ip: r.ip,
        userAgent: r.user_agent,
        detail: shownDetail(r.detail),
      })),
      next: this.next,
    };
  }
}
