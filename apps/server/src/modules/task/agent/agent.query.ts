import { Injectable } from '@nestjs/common';
import {
  type Actor,
  AgentCard,
  ApprovedActor,
  BaseQuery,
  NotFound,
  SettingActor,
} from '../../platform';
import { agentRevisions, agents } from '../task.schema';
import type { AgentRow } from '../task.tables';
import type { ListAgentsInput } from './agent.input';
import {
  AgentLeadView,
  AgentListView,
  AgentRevisionListView,
  AgentTeamListView,
  AgentView,
} from './agent.view';
import { AgentTeams } from './agent-team.policy';

// 에이전트 읽기. 주인만. 이번 달 사용량은 실행 기록에서 더하고, 하트비트를 함께 싣는다.
// 대표(O-2)는 목록 · 다른 모듈의 카드에 보이지 않고 lead로만 읽는다
@Injectable()
export class AgentQuery extends BaseQuery {
  /** 설정 판 목록 (새 판부터). 실행 기록의 agentRevision을 이 판과 맞춰 본다 */
  async revisions(actor: Actor, id: string): Promise<AgentRevisionListView> {
    actor.assertOwner();
    if (!(await this.exists(agents, { space_id: actor.requireSpace(), id })))
      throw new NotFound('에이전트를 찾을 수 없어요');
    return new AgentRevisionListView(
      await this.rows(agentRevisions, { agent_id: id }, { order: ['revision desc'] }),
    );
  }

  /**
   * 다른 모듈이 platform AgentDirectory로 묻는 에이전트 하나와 그 위 보고 대상 (예: blog 앱 · 메뉴의 운영 팀). 지운 에이전트 · 대표는 없다.
   * 관리자, 관리자가 확인한 길로 오는 설정 바꾸기(제안의 미리 해 보기 · 승인 뒤 적용, 2026-11-15 D),
   * 에이전트 자신(글을 놓을 때 자기가 운영 팀 안인지, 스토어 2단계)이 읽는다
   */
  async card(actor: Actor, id: string): Promise<AgentCard | null> {
    const self = actor.kind === 'agent' && actor.id === id;
    if (!(self || actor instanceof SettingActor || actor instanceof ApprovedActor))
      actor.assertOwner();
    const spaceId = actor.requireSpace();
    const [row] = await this.sql<
      (Pick<AgentRow, 'id' | 'name' | 'scopes'> & { chain: string[] })[]
    >`
      WITH RECURSIVE up AS (
        SELECT reports_to AS id, 1 AS depth FROM task.agents
        WHERE space_id = ${spaceId} AND id = ${id} AND deleted_at IS NULL AND NOT lead
        UNION ALL
        SELECT a.reports_to, up.depth + 1 FROM up JOIN task.agents a ON a.id = up.id
        WHERE up.depth < 10
      )
      SELECT a.id, a.name, a.scopes,
        coalesce((SELECT array_agg(up.id::text ORDER BY up.depth) FROM up WHERE up.id IS NOT NULL), '{}') AS chain
      FROM task.agents a
      WHERE a.space_id = ${spaceId} AND a.id = ${id} AND a.deleted_at IS NULL AND NOT a.lead`;
    return row ? new AgentCard(row.id, row.name, row.scopes, row.chain) : null;
  }

  /** 팀 템플릿 목록 (코드에 둔 것, AgentTeams) */
  teams(actor: Actor): AgentTeamListView {
    actor.assertOwner();
    return new AgentTeamListView(AgentTeams.ALL);
  }

  /**
   * 지우면 안 되는 까닭 (없으면 빈 목록): 진행 중인 작업(대기 · 실행 · 결재 · 하위 작업 대기), 스케줄, 도는 목표 실행.
   * 조용히 취소하지 않는다: 주인이 끝내거나 옮긴 뒤 지운다
   */
  async blockers(actor: Actor, ids: readonly string[]): Promise<readonly string[]> {
    actor.assertOwner();
    const [row] = await this.sql<{ tasks: number; schedules: number; runs: number }[]>`
      SELECT
        (SELECT count(*)::int FROM task.tasks WHERE agent_id = ANY(${ids as string[]}::uuid[])
           AND status IN ('queued', 'running', 'waiting')) AS tasks,
        (SELECT count(*)::int FROM task.schedules WHERE agent_id = ANY(${ids as string[]}::uuid[])) AS schedules,
        (SELECT count(*)::int FROM task.goal_runs WHERE agent_id = ANY(${ids as string[]}::uuid[])
           AND status IN ('running', 'waiting')) AS runs`;
    return [
      row?.tasks ? `진행 중인 작업 ${row.tasks}개 (끝나거나 취소한 뒤에)` : '',
      row?.schedules ? `스케줄 ${row.schedules}개 (스케줄을 지우거나 담당을 바꾼 뒤에)` : '',
      row?.runs ? `도는 목표 실행 ${row.runs}개 (멈춘 뒤에)` : '',
    ].filter(Boolean);
  }

  async list(actor: Actor, req: ListAgentsInput): Promise<AgentListView> {
    actor.assertOwner();
    const rows = await this.sql<(AgentRow & { used: number; schedules: number })[]>`
      SELECT a.*, (
        SELECT coalesce(sum(e.tokens), 0)::bigint
        FROM task.task_events e JOIN task.tasks t ON t.id = e.task_id
        WHERE t.agent_id = a.id AND e.at >= date_trunc('month', now())
      ) AS used,
      (SELECT count(*)::int FROM task.schedules s WHERE s.agent_id = a.id) AS schedules
      FROM task.agents a
      WHERE a.space_id = ${actor.spaceId} AND (a.deleted_at IS NOT NULL) = ${req.deleted}
        AND NOT a.lead
      ORDER BY a.id`;
    return new AgentListView(rows.map((r) => new AgentView(r, r.used, r.schedules)));
  }

  /** 대표 (O-2): 설정 › AI의 대표 칸. 이번 달에 쓴 토큰까지. 첫 대화 전이라 아직 없으면 null */
  async lead(actor: Actor): Promise<AgentLeadView> {
    actor.assertOwner();
    const [row] = await this.sql<(AgentRow & { used: number })[]>`
      SELECT a.*, (
        SELECT coalesce(sum(e.tokens), 0)::bigint
        FROM task.task_events e JOIN task.tasks t ON t.id = e.task_id
        WHERE t.agent_id = a.id AND e.at >= date_trunc('month', now())
      ) AS used
      FROM task.agents a
      WHERE a.space_id = ${actor.requireSpace()} AND a.lead AND a.deleted_at IS NULL`;
    return new AgentLeadView(row ? new AgentView(row, row.used, 0) : null);
  }
}
