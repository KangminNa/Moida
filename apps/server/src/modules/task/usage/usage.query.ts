import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery } from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { TeamRoster } from '../task/team-roster';
import { AGENT_TOOL } from '../task.tables';
import { PlanUsage } from './plan-usage';
import { PlanUsageRepository } from './plan-usage.repository';
import { PlanWindowView, UsageView } from './usage.view';

// 사용량 읽기. 주인만. 쉬는지와 창이 유효한지는 일을 빌릴 때와 같은 규칙(Agent.holds, PlanUsage.validAt)으로 정한다.
@Injectable()
export class UsageQuery extends BaseQuery {
  async overview(actor: Actor): Promise<UsageView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const now = new Date();
    const repo = new AgentRepository(this.sql);
    const usage = await repo.usage(spaceId, now);
    const seen = await new PlanUsageRepository(this.sql).list(spaceId);
    // 성적표 (2026-11-20): 팀원 줄과 같은 SQL
    const scores = new Map((await repo.scores(spaceId, now)).map((s) => [s.agent_id, s]));
    const agents = usage.map((u) =>
      u.view().withScore(scores.get(u.agent.id) ?? null, TeamRoster.SCORE_DAYS),
    );
    // 값이 없는 창도 보낸다: 화면이 확인 전으로 보여 준다
    const tools = new Set([...usage.map((u) => u.agent.tool), ...seen.map((p) => p.tool)]);
    const plan = AGENT_TOOL.filter((tool) => tools.has(tool)).flatMap((tool) =>
      PlanUsage.WINDOWS.map(
        (window) =>
          seen.find((p) => p.covers(tool, window))?.view(now) ??
          new PlanWindowView(tool, window, null, false),
      ),
    );
    return new UsageView(agents, plan);
  }
}
