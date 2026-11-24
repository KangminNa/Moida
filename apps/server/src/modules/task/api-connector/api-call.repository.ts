import { type DomainEvent, Outbox, TableRepository } from '../../platform';
import { apiCalls } from '../task.schema';
import type { ApiCallRow } from '../task.tables';
import { ApiCall } from './api-call';

// task.api_calls ↔ ApiCall (2026-11-24). next_at이 바뀌면 저장이 상태 묻기 · 파일 받기 일꾼(ApiCallJob)을 깨운다.
export class ApiCallRepository extends TableRepository<ApiCallRow, ApiCall> {
  protected readonly table = apiCalls;
  protected readonly noun = 'API 부르기';
  protected override readonly dueWake = [ApiCall.JOB, ['next_at']] as const;
  /** 하루 한도를 세는 창 */
  static readonly DAY_MS = 24 * 60 * 60 * 1000;

  protected toEntity(row: ApiCallRow): ApiCall {
    return ApiCall.restore(row);
  }

  /** 같은 요청(공간 · request_id)의 앞 부르기. 없으면 null */
  async byRequest(spaceId: string, requestId: string): Promise<ApiCall | null> {
    return this.findOne({ space_id: spaceId, request_id: requestId });
  }

  /** 결재를 기다리는 부르기 (잠가서) */
  async lockHeld(spaceId: string, approvalId: string): Promise<ApiCall | null> {
    return this.findOne({ space_id: spaceId, approval_id: approvalId }, { lock: true });
  }

  /** 커넥터의 최근 24시간 돈이 드는 부르기 수 (승인을 기다리거나 승인되지 않은 것은 세지 않는다) */
  async spentSince(connectorId: string, now: Date): Promise<number> {
    const since = new Date(now.getTime() - ApiCallRepository.DAY_MS);
    const [row] = await this.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM task.api_calls
      WHERE connector_id = ${connectorId} AND effect = 'spend' AND created_at > ${since}
        AND status NOT IN ('held', 'refused')`;
    return row?.n ?? 0;
  }

  /** 때가 된 상태 묻기 · 파일 받기 (모든 공간, 이른 것부터). 다른 일꾼이 잡은 줄은 건너뛴다 */
  async due(now: Date, limit: number): Promise<readonly ApiCall[]> {
    const rows = await this.sql<ApiCallRow[]>`
      SELECT * FROM task.api_calls
      WHERE next_at IS NOT NULL AND next_at <= ${now} AND status IN ('polling', 'fetching')
      ORDER BY next_at, id LIMIT ${limit}`;
    return rows.map((r) => this.toEntity(r));
  }

  /** 아직 때가 안 된 것 가운데 가장 이른 시각. 없으면 null */
  async nextDue(): Promise<Date | null> {
    const [row] = await this.sql<{ at: Date | null }[]>`
      SELECT min(next_at) AS at FROM task.api_calls WHERE next_at IS NOT NULL`;
    return row?.at ?? null;
  }

  /** 작업의 지금 실행 (결과물이 그 실행에 붙는다). 없으면 null */
  async runOf(taskId: string): Promise<string | null> {
    const [row] = await this.sql<{ id: string }[]>`
      SELECT id FROM task.task_runs WHERE task_id = ${taskId} ORDER BY seq DESC LIMIT 1`;
    return row?.id ?? null;
  }

  /** 부르기 저장과 따로 내는 이벤트 (승인 뒤 부르기의 결과: 기다리던 작업이 이어서 한다) */
  async announce(event: DomainEvent): Promise<void> {
    await new Outbox(this.sql).publish([event]);
  }
}
