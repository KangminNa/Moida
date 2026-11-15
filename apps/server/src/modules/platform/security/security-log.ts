import { isIP } from 'node:net';
import { AttemptLimiter } from '../base/attempt-limiter';
import type { Sql } from '../base/database';
import type { SecurityEventNew } from '../platform.tables';

/** 남길 보안 사건. id · 시각 · 곳 · 횟수는 여기와 DB가 정한다 */
export type SecurityNew = Pick<SecurityEventNew, 'space_id' | 'kind' | 'ip' | 'user_agent'> & {
  /** 사건의 내용: 짧은 값만 (방법 · 경로 · 상태 · 기기 이름). 비밀번호 · 토큰 · 쿠키 값은 넣지 않는다 */
  detail?: Readonly<Record<string, string | number | boolean | null>>;
};

// 보안 기록 (기획서 결정 2026-11-15): 로그인 · 로그아웃 · 비밀번호 · 설치 코드 · 기기 · 거부된 접근을 platform.security_events에 남긴다.
// Notices처럼 부르는 쪽의 연결(트랜잭션)을 받는다: 로그인 성공은 세션을 만드는 트랜잭션과 함께 남는다.
// platform은 종류의 뜻을 모른다 (이름 · 내용은 기록하는 모듈이 정한다).
// 같은 공간 · 종류 · 곳 · 내용이 MERGE_SECONDS 안에 또 오면 줄을 늘리지 않고 count · last_at만 올린다:
// 찔러보기가 몰려도 기록이 한 줄씩 불어나지 않고, 화면에는 "N번"으로 보인다.
export class SecurityLog {
  static readonly MERGE_SECONDS = 60;
  /** 이 날수가 지난 줄은 일꾼이 지운다 */
  static readonly KEEP_DAYS = 90;
  private static readonly AGENT_MAX = 200;

  constructor(private readonly sql: Sql) {}

  /** 남긴다. 새 줄이면 true, 1분 안의 같은 사건에 합쳤으면 false (알림을 한 번만 보내게) */
  async record(event: SecurityNew): Promise<boolean> {
    const ip = event.ip && isIP(event.ip) ? event.ip : null;
    const place = ip ? AttemptLimiter.place(ip) : null;
    const spaceId = event.space_id ?? null;
    const detail = this.sql.json((event.detail ?? {}) as never);
    const [merged] = await this.sql<{ id: string }[]>`
      UPDATE platform.security_events SET count = count + 1, last_at = now()
      WHERE kind = ${event.kind} AND place IS NOT DISTINCT FROM ${place}
        AND space_id IS NOT DISTINCT FROM ${spaceId}::uuid AND detail = ${detail}
        AND last_at > now() - make_interval(secs => ${SecurityLog.MERGE_SECONDS})
      RETURNING id`;
    if (merged) return false;
    const row = {
      space_id: spaceId,
      kind: event.kind,
      ip,
      place,
      user_agent: event.user_agent ? event.user_agent.slice(0, SecurityLog.AGENT_MAX) : null,
      detail,
    };
    await this.sql`INSERT INTO platform.security_events ${this.sql(row as never)}`;
    return true;
  }

  /** 보관 기간이 지난 줄을 지운다. 지운 수 */
  async purge(now: Date): Promise<number> {
    const before = new Date(now.getTime() - SecurityLog.KEEP_DAYS * 86_400_000);
    const rows = await this.sql<{ id: string }[]>`
      DELETE FROM platform.security_events WHERE at < ${before} RETURNING id`;
    return rows.length;
  }
}
