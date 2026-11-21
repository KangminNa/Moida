import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery, Database, SecretBox } from '../../platform';
import type { Agent } from '../agent/agent';
import type { JobToolView } from '../task/job.view';
import { externalTools } from '../task.schema';
import type { TaskRow } from '../task.tables';
import { ExternalTool } from './external-tool';
import { ExternalToolListView } from './external-tool.view';

// 외부 도구 읽기 (2차 7단계). 관리 화면의 목록과, 일을 빌려 줄 때 그 에이전트에게 붙일 도구.
// 토큰을 푸는 곳은 forJob 하나뿐이다 (러너에게 가는 일에만 싣는다).
@Injectable()
export class ExternalToolQuery extends BaseQuery {
  constructor(
    db: Database,
    private readonly box: SecretBox,
  ) {
    super(db);
  }

  /** 콘솔의 외부 도구 메뉴 (주인만). 이름순, 도구마다 허락한 에이전트 */
  async list(actor: Actor): Promise<ExternalToolListView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const rows = await this.rows(externalTools, { space_id: spaceId }, { order: ['name'] });
    const agents = await this.sql<{ id: string; name: string; external_tools: string[] }[]>`
      SELECT id, name, external_tools FROM task.agents
      WHERE space_id = ${spaceId} AND deleted_at IS NULL AND cardinality(external_tools) > 0
      ORDER BY id`;
    return new ExternalToolListView(
      rows.map((r) =>
        ExternalTool.restore(r).view(agents.filter((a) => a.external_tools.includes(r.name))),
      ),
    );
  }

  /**
   * 일을 빌려 줄 때 그 에이전트에게 붙일 도구 (next_jobs의 tools). 러너만 부른다.
   * 객체설계 4장의 예외: 토큰을 푸는 읽기라 엔티티(`ExternalTool.jobView`)를 거친다 (`AiLoginQuery.token`과 같다)
   * 허락한 이름 중 켜져 있고 토큰이 갖춰진 것만 (OAuth면 로그인했고 접근 토큰이 끝나지 않은 것, C1)
   */
  async forJob(
    actor: Actor,
    agent: Agent | null,
    checkedToolId: string | null,
  ): Promise<readonly JobToolView[]> {
    actor.assertCan(Actor.RUN);
    // 커넥터 확인 (tool_check, 2026-11-15 MCP 1단계): 에이전트가 없고 확인할 도구 하나만 (러너가 tools/list를 부른다)
    if (checkedToolId !== null) return this.checked(actor.requireSpace(), checkedToolId);
    if (!agent || agent.externalTools.length === 0) return [];
    const rows = await this.rows(externalTools, {
      space_id: agent.spaceId,
      name: [...agent.externalTools],
      status: ExternalTool.ACTIVE,
    });
    const now = new Date();
    return rows
      .map((r) => ExternalTool.restore(r))
      .filter((t) => t.ready(now))
      .map((t) => t.jobView(this.box));
  }

  /**
   * 끝난 작업 하나 (ExternalToolService.noteTask). 커넥터 확인의 결과 · 에이전트의 일의 커넥터 사용을 적으려고 읽는다.
   * 에이전트가 허락받은 도구 이름을 함께 (그 이름만 적는다)
   */
  async finished(actor: Actor, spaceId: string, taskId: string): Promise<FinishedTask | null> {
    actor.assertOwnerOrSystem();
    const [row] = await this.sql<FinishedTask[]>`
      SELECT t.kind, t.status, t.payload, t.result, t.finished_at,
        coalesce(a.external_tools, '{}') AS external_tools
      FROM task.tasks t LEFT JOIN task.agents a ON a.id = t.agent_id
      WHERE t.space_id = ${spaceId} AND t.id = ${taskId}`;
    return row ?? null;
  }

  private async checked(spaceId: string, toolId: string): Promise<readonly JobToolView[]> {
    const rows = await this.rows(externalTools, { space_id: spaceId, id: toolId });
    const now = new Date();
    return rows
      .map((r) => ExternalTool.restore(r))
      .filter((t) => t.ready(now))
      .map((t) => t.jobView(this.box));
  }
}

/** 끝난 작업에서 읽는 칸 (표 행에 에이전트의 허락 목록을 더한 모양) */
export type FinishedTask = Pick<
  TaskRow,
  'kind' | 'status' | 'payload' | 'result' | 'finished_at'
> & {
  external_tools: string[];
};
