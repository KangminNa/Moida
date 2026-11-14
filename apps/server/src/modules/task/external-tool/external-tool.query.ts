import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery, Database, SecretBox } from '../../platform';
import type { Agent } from '../agent/agent';
import { AgentScopes } from '../agent/agent-scopes.policy';
import type { JobToolRow } from '../task/job.view';
import { externalTools } from '../task.schema';
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

  /** 공간에 없는 이름 (에이전트에게 허락하기 전에 본다) */
  async missing(actor: Actor, names: readonly string[]): Promise<readonly string[]> {
    actor.assertOwner();
    const rows = await this.rows(
      externalTools,
      { space_id: actor.requireSpace(), name: [...names] },
      { columns: ['name'] },
    );
    const found = new Set(rows.map((r) => r.name));
    return names.filter((n) => !found.has(n));
  }

  /**
   * 일을 빌려 줄 때 그 에이전트에게 붙일 도구 (next_jobs의 tools). 러너만 부른다.
   * 허락한 이름 중 켜져 있고 토큰이 갖춰진 것만. 비공개를 읽거나 셸이 있는 에이전트에게는 늘 없음 (저장된 값이 어긋나도 여기서 한 번 더)
   */
  async forJob(actor: Actor, agent: Agent | null): Promise<readonly JobToolRow[]> {
    actor.assertCan(Actor.RUN);
    if (!agent || agent.externalTools.length === 0 || !AgentScopes.mayUseTools(agent.scopes))
      return [];
    const rows = await this.rows(externalTools, {
      space_id: agent.spaceId,
      name: [...agent.externalTools],
      status: ExternalTool.ACTIVE,
    });
    return rows
      .map((r) => ExternalTool.restore(r))
      .filter((t) => t.ready)
      .map((t) => t.jobTool(this.box));
  }
}
