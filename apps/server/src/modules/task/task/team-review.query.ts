import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, Forbidden } from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { agents } from '../task.schema';
import type { AgentRow, TaskRow } from '../task.tables';
import type { AgentScoreRow } from '../usage/usage.view';
import { TeamReview, type TeamReviewRow } from './team-review.policy';

// 주간 팀 점검의 읽기 (2026-11-20, TeamReview): 지난 점검 일, 그 뒤로 끝난 에이전트의 일 수, 팀원(대표 빼고)과 성적표.
// 성적표는 팀원 정보와 같은 SQL(AgentRepository.scores)을 쓴다. 일꾼(SystemActor)이 부른다. 공간 밖은 읽지 않는다
@Injectable()
export class TeamReviewQuery extends BaseQuery {
  /** 공간의 대표와 생긴 때. 대화를 연 적이 없으면 null (점검도 없다) */
  async lead(actor: Actor, spaceId: string): Promise<Pick<AgentRow, 'id' | 'created_at'> | null> {
    TeamReviewQuery.assertSpace(actor, spaceId);
    return this.row(
      agents,
      { space_id: spaceId, lead: true, deleted_at: null },
      { columns: ['id', 'created_at'] },
    );
  }

  /** 가장 최근의 점검 일 */
  async last(
    actor: Actor,
    spaceId: string,
  ): Promise<Pick<TaskRow, 'status' | 'created_at'> | null> {
    TeamReviewQuery.assertSpace(actor, spaceId);
    const [row] = await this.sql<Pick<TaskRow, 'status' | 'created_at'>[]>`
      SELECT status, created_at FROM task.tasks
      WHERE space_id = ${spaceId} AND request_id LIKE ${`${TeamReview.PREFIX}${spaceId}:%`}
      ORDER BY created_at DESC, id DESC LIMIT 1`;
    return row ?? null;
  }

  /** since 뒤에 끝난(완료) 에이전트의 일 수 (대표 · 점검 일 자신도 센다: 많고 적음만 본다) */
  async doneSince(actor: Actor, spaceId: string, since: Date): Promise<number> {
    TeamReviewQuery.assertSpace(actor, spaceId);
    const [row] = await this.sql<{ done: number }[]>`
      SELECT count(*)::int AS done FROM task.tasks
      WHERE space_id = ${spaceId} AND agent_id IS NOT NULL AND status = 'done' AND finished_at >= ${since}`;
    return row?.done ?? 0;
  }

  /** 팀원 (대표 빼고, 지운 것 빼고): 보고 대상 이름 · 쥔 일 */
  members(actor: Actor, spaceId: string): Promise<readonly TeamReviewRow[]> {
    TeamReviewQuery.assertSpace(actor, spaceId);
    return this.sql<TeamReviewRow[]>`
      SELECT a.id, a.name, a.role, a.tool, a.model, a.status, b.name AS boss,
        (SELECT count(*)::int FROM task.tasks t
          WHERE t.agent_id = a.id AND t.status IN ('queued', 'running', 'waiting')) AS open
      FROM task.agents a
      LEFT JOIN task.agents b ON b.id = a.reports_to AND b.deleted_at IS NULL
      WHERE a.space_id = ${spaceId} AND a.deleted_at IS NULL AND NOT a.lead
      ORDER BY a.created_at, a.id`;
  }

  /** 최근 기간의 성적표 (팀원 정보 · 팀 화면과 같은 SQL) */
  scores(actor: Actor, spaceId: string, now: Date): Promise<readonly AgentScoreRow[]> {
    TeamReviewQuery.assertSpace(actor, spaceId);
    return new AgentRepository(this.sql).scores(spaceId, now);
  }

  private static assertSpace(actor: Actor, spaceId: string): void {
    if (actor.spaceId !== null && actor.spaceId !== spaceId) throw new Forbidden('space');
  }
}
