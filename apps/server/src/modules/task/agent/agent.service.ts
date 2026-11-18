import { Injectable } from '@nestjs/common';
import {
  type Actor,
  Database,
  EntityService,
  Idempotency,
  NotFound,
  RuleViolation,
  SettingActor,
  type SettingChangeInput,
  SettingOutcome,
  type Sql,
  type VersionInput,
} from '../../platform';
import { SettingChanges } from '../setting-change/setting-change.policy';
import { Agent } from './agent';
import type {
  CreateAgentInput,
  CreateAgentTeamInput,
  DeleteAgentInput,
  UpdateAgentInput,
} from './agent.input';
import { AgentQuery } from './agent.query';
import { AgentRepository } from './agent.repository';
import { AgentEdit } from './agent-edit';
import { AgentOrg } from './agent-org.policy';
import { AgentTeams } from './agent-team.policy';

// 에이전트 쓰기: 만들기, 고치기, 멈추기, 다시 시작, 휴지통 · 복원. 모두 주인만.
// 보고 대상을 정할 때는 조직도 전체를 잠근다 (AgentRepository.lockAll): 동시에 바꿔도 순환이 생기지 않게.
@Injectable()
export class AgentService extends EntityService<Agent> {
  private static readonly CREATE = 'create_agent';
  private static readonly CREATE_TEAM = 'create_agent_team';

  constructor(
    db: Database,
    private readonly agents: AgentQuery,
  ) {
    super(db);
  }

  protected store(tx: Sql): AgentRepository {
    return new AgentRepository(tx);
  }

  /**
   * 휴지통으로 (기획서 결정 2026-11-14). team이면 아래 팀 전체를 아래부터, 아니면 바로 아래 팀원을 이 에이전트의 보고 대상으로
   * 올린다. 진행 중인 작업 · 스케줄 · 도는 목표 실행이 있으면 지우지 않고 까닭을 알린다 (조용히 취소하지 않는다)
   */
  async delete(actor: Actor, req: DeleteAgentInput): Promise<Agent> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const agents = new AgentRepository(tx);
      const org = await agents.lockAll(spaceId);
      const agent = org.find((a) => a.id === req.id && !a.deleted);
      if (!agent) throw new NotFound('에이전트를 찾을 수 없어요');
      agent.assertVersion(req.version);
      const gone = AgentOrg.toDelete(agent, org, req.team);
      const why = await this.agents.blockers(
        actor,
        gone.map((a) => a.id),
      );
      if (why.length > 0) throw new RuleViolation(`삭제할 수 없어요: ${why.join(', ')}`);
      const now = new Date();
      const moved = gone.flatMap((a) => a.delete(org, now));
      for (const a of new Set([...moved, ...gone])) await agents.save(a);
      return agent;
    });
  }

  /** 휴지통에서 되돌린다 (보고 대상이 그사이 지워졌으면 주인 아래로) */
  async restore(actor: Actor, req: VersionInput): Promise<Agent> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const agents = new AgentRepository(tx);
      const org = await agents.lockAll(spaceId);
      const agent = org.find((a) => a.id === req.id);
      if (!agent) throw new NotFound('에이전트를 찾을 수 없어요');
      agent.assertVersion(req.version);
      agent.restore(org);
      await agents.save(agent);
      return agent;
    });
  }

  /** 같은 requestId가 다시 오면 처음 만든 에이전트를 돌려준다 */
  async create(actor: Actor, req: CreateAgentInput): Promise<Agent> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const agents = new AgentRepository(tx);
      const once = new Idempotency(tx, actor.id ?? spaceId, req.requestId, AgentService.CREATE);
      const before = await once.previous();
      if (before) return agents.load(spaceId, String(before.agentId));
      const agent = await new AgentEdit(tx, spaceId).open(req, new Date());
      await agents.save(agent);
      await once.remember({ agentId: agent.id });
      return agent;
    });
  }

  /**
   * 템플릿으로 팀 하나를 한 트랜잭션에서 만든다 (반쪽 팀이 남지 않게). 조직도 전체를 잠근 뒤 보고 대상이 앞인 순서로
   * 만들고 잇는다. 같은 requestId가 다시 오면 처음 만든 팀을 돌려준다
   */
  async createTeam(actor: Actor, req: CreateAgentTeamInput): Promise<readonly Agent[]> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const team = AgentTeams.of(req.team);
    return this.transaction(async (tx) => {
      const agents = new AgentRepository(tx);
      const once = new Idempotency(
        tx,
        actor.id ?? spaceId,
        req.requestId,
        AgentService.CREATE_TEAM,
      );
      const before = await once.previous();
      if (before)
        return Promise.all((before.agentIds as string[]).map((id) => agents.load(spaceId, id)));
      const org = [...(await agents.lockAll(spaceId))];
      const made = new Map<string, Agent>();
      const now = new Date();
      for (const m of team.members) {
        const agent = Agent.open(
          spaceId,
          {
            name: m.name,
            role: m.role,
            tool: req.tool,
            scopes: m.scopes,
            approval_actions: m.approval_actions,
          },
          now,
        );
        org.push(agent);
        agent.reportTo(m.reports_to === null ? null : (made.get(m.reports_to)?.id ?? null), org);
        made.set(m.key, agent);
      }
      for (const agent of made.values()) await agents.save(agent);
      await once.remember({ agentIds: [...made.values()].map((a) => a.id) });
      return [...made.values()];
    });
  }

  /** 보고 대상 · 러너 · 검토자의 규칙은 AgentEdit (제안 · 승인 뒤 적용과 같은 줄) */
  async update(actor: Actor, req: UpdateAgentInput): Promise<Agent> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const agent = await new AgentEdit(tx, spaceId).update(req);
      await new AgentRepository(tx).save(agent);
      return agent;
    });
  }

  /** 설정 바꾸기 제안의 미리 해 보기 (2026-11-15 C · D): 관리자의 고치기와 같은 줄(AgentEdit)을 지나고 저장하지 않는다 */
  async rehearseSetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingActor.spaceOf(actor);
    await this.transaction(async (tx) => {
      await new AgentEdit(tx, spaceId).apply(change, new Date());
    });
  }

  /**
   * 승인한 설정 바꾸기 (2026-11-15 C, SettingApplyHandler): 관리자의 고치기와 같은 줄(AgentEdit).
   * 결재마다 한 번만 적용하고 결과(task.setting.changed)를 남긴다. 승인한 뒤 바뀌었으면 실패로 끝난다
   */
  async applySetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingOutcome.spaceOf(actor, change.key);
    await SettingOutcome.settle(
      (work) => this.transaction(work),
      SettingChanges.TOPIC,
      spaceId,
      change.key,
      async (tx) => {
        const agent = await new AgentEdit(tx, spaceId).apply(change, new Date());
        await new AgentRepository(tx).save(agent);
      },
    );
  }

  pause(actor: Actor, req: VersionInput): Promise<Agent> {
    return this.changeAsOwner(actor, req, (agent) => agent.pause());
  }

  resume(actor: Actor, req: VersionInput): Promise<Agent> {
    return this.changeAsOwner(actor, req, (agent) => agent.resume());
  }
}
