import { setTimeout as sleep } from 'node:timers/promises';
import { Injectable } from '@nestjs/common';
import { Actor, AgentActor, BaseQuery, Database, NotFound, SecretBox } from '../../platform';
import { apiCalls, apiConnectors } from '../task.schema';
import type { ApiCallRow } from '../task.tables';
import { ApiCall } from './api-call';
import { ApiConnector } from './api-connector';
import type { ApiCallInput } from './api-connector.input';
import {
  ApiCallLineView,
  ApiCallListView,
  type ApiCallView,
  ApiConnectorListView,
  ApiToolListView,
} from './api-connector.view';

// API 커넥터 읽기 (2026-11-24): 관리 화면의 목록 · 최근 부르기, 일꾼의 api_tools · api_call.
// 객체설계 4장의 예외: 머리글마다 키를 넣었는지 보려고 잠근 키를 여는 읽기라 엔티티(ApiConnector.view · toolView)를 거친다
// (값은 내보내지 않는다, ExternalTool.jobView와 같다)
@Injectable()
export class ApiConnectorQuery extends BaseQuery {
  /** api_call이 기다리는 동안 다시 보는 간격 */
  private static readonly WAIT_STEP_MS = 1500;
  private static readonly OPEN: readonly ApiCallRow['status'][] = [
    'running',
    'polling',
    'fetching',
  ];

  constructor(
    db: Database,
    private readonly box: SecretBox,
  ) {
    super(db);
  }

  /** 콘솔의 커넥터 목록 (관리자만). 이름순, 커넥터마다 최근 24시간 돈이 든 부르기 수 */
  async list(actor: Actor): Promise<ApiConnectorListView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const rows = await this.rows(apiConnectors, { space_id: spaceId }, { order: ['name'] });
    const spent = await this.spent(spaceId);
    return new ApiConnectorListView(
      rows.map((r) => ApiConnector.restore(r).view(this.box, spent.get(r.id) ?? 0)),
    );
  }

  /** 커넥터 하나의 최근 부르기 20개 (관리자만) */
  async calls(actor: Actor, connectorId: string): Promise<ApiCallListView> {
    actor.assertOwner();
    const rows = await this.rows(
      apiCalls,
      { space_id: actor.requireSpace(), connector_id: connectorId },
      { order: ['created_at desc'], limit: 20 },
    );
    return new ApiCallListView(rows.map((r) => new ApiCallLineView(r)));
  }

  /** 일꾼이 부를 수 있는 커넥터 (MCP api_tools): 켜진 것만, 키가 갖춰졌는지 · 남은 횟수와 함께 */
  async tools(actor: Actor): Promise<ApiToolListView> {
    actor.assertCan(Actor.AGENT);
    const spaceId = actor.requireSpace();
    const rows = await this.rows(
      apiConnectors,
      { space_id: spaceId, status: ApiConnector.ACTIVE },
      { order: ['name'] },
    );
    const spent = await this.spent(spaceId);
    return new ApiToolListView(
      rows.map((r) => ApiConnector.restore(r).toolView(this.box, spent.get(r.id) ?? 0)),
    );
  }

  /** 부르기 하나 (MCP api_call): 같은 작업이 연 것만. wait_seconds까지 끝나기를 기다린다 */
  async call(actor: Actor, req: ApiCallInput): Promise<ApiCallView> {
    if (!(actor instanceof AgentActor) || !actor.spaceId) throw new NotFound('없는 부르기예요');
    const until = Date.now() + req.waitSeconds * 1000;
    for (;;) {
      const row = await this.row(apiCalls, {
        space_id: actor.spaceId,
        id: req.callId,
        task_id: actor.taskId,
      });
      if (!row) throw new NotFound('없는 부르기예요 (이 일에서 부른 것만 봐요)');
      const done = !ApiConnectorQuery.OPEN.includes(row.status);
      if (done || Date.now() + ApiConnectorQuery.WAIT_STEP_MS > until)
        return ApiCall.restore(row).view();
      await sleep(ApiConnectorQuery.WAIT_STEP_MS);
    }
  }

  /** 커넥터마다 최근 24시간 돈이 든 부르기 수 (ApiCallRepository.spentSince와 같은 셈) */
  private async spent(spaceId: string): Promise<Map<string, number>> {
    const rows = await this.sql<{ connector_id: string; n: number }[]>`
      SELECT connector_id, count(*)::int AS n FROM task.api_calls
      WHERE space_id = ${spaceId} AND effect = 'spend' AND created_at > now() - interval '24 hours'
        AND status NOT IN ('held', 'refused')
      GROUP BY connector_id`;
    return new Map(rows.map((r) => [r.connector_id, r.n]));
  }
}
