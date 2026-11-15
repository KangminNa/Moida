import {
  RuleViolation,
  type SettingChangeInput,
  type SettingShape,
  type Sql,
} from '../../platform';
import { ExternalToolRepository } from '../external-tool/external-tool.repository';
import { RunnerRepository } from '../runner/runner.repository';
import { Agent } from './agent';
import { CreateAgentInput, UpdateAgentInput } from './agent.input';
import { AgentRepository } from './agent.repository';

/**
 * 에이전트 만들기 · 고치기 한 번을 부르는 쪽의 트랜잭션에서 (2026-11-15 C).
 * 관리자의 고치기(AgentService), 설정 바꾸기 제안의 미리 해 보기(SettingChangeService), 승인 뒤 적용이 같은 줄을 지난다.
 * 필요한 것만 잠그고 읽어 엔티티 메서드를 부른다. 저장은 부르는 쪽이 정한다 (미리 해 보기는 저장하지 않는다)
 */
export class AgentEdit {
  /** 대화로 바꾸는 에이전트 (get_settings team · propose_setting agent, 2026-11-15 C). 굵게: 권한을 더하는 칸 */
  static readonly SETTING: SettingShape = {
    setting: 'agent',
    list: 'team',
    ops: ['create', 'edit', 'pause', 'resume'],
    fields: [
      'name',
      'role',
      'tool',
      'model',
      'effort',
      'scopes',
      'approval_actions',
      'reports_to',
      'reviewer_id',
      'runner_id',
      'external_tools',
      'monthly_limit',
      'five_hour_limit',
      'plan_stop_percent',
    ],
    target: 'id',
    versioned: true,
    grants: ['scopes', 'approval_actions', 'external_tools', 'runner_id'],
  };

  constructor(
    private readonly tx: Sql,
    private readonly spaceId: string,
  ) {}

  /** 새 에이전트 (아직 저장 전). 보고 대상을 정하면 조직도 전체를 잠근다 */
  async open(req: CreateAgentInput, now: Date): Promise<Agent> {
    await this.assertKnownTools(req.fields.external_tools);
    const agent = Agent.open(this.spaceId, req.fields, now);
    if (req.reportsTo !== null)
      agent.reportTo(req.reportsTo, await new AgentRepository(this.tx).lockAll(this.spaceId));
    if (req.runnerId !== null) agent.edit({}, await this.runner(req.runnerId));
    return agent;
  }

  /** 보고 대상을 바꾸지 않으면 그 에이전트만 잠근다. 러너 · 검토자는 같은 공간의 것만 (없으면 404) */
  async update(req: UpdateAgentInput): Promise<Agent> {
    await this.assertKnownTools(req.changes.external_tools);
    const { reportsTo, runnerId, reviewerId } = req;
    const agents = new AgentRepository(this.tx);
    const org = reportsTo === undefined ? [] : await agents.lockAll(this.spaceId);
    const agent = org.find((a) => a.id === req.id) ?? (await agents.lock(this.spaceId, req.id));
    agent.assertVersion(req.version);
    if (reportsTo !== undefined) agent.reportTo(reportsTo, org);
    agent.edit(req.changes, typeof runnerId === 'string' ? await this.runner(runnerId) : runnerId);
    if (reviewerId !== undefined)
      agent.pairReviewer(reviewerId === null ? null : await agents.load(this.spaceId, reviewerId));
    return agent;
  }

  /**
   * 설정 바꾸기 하나 (2026-11-15 C): 제안의 미리 해 보기와 승인 뒤 적용이 같은 줄.
   * body는 관리자 REST(POST · PATCH api/agents)와 같은 본문, key는 만들기의 requestId (결재 id)
   */
  apply(change: SettingChangeInput, now: Date): Promise<Agent> {
    const { op, body, version } = change;
    const id = String(change.targetId);
    if (op === 'create')
      return this.open(CreateAgentInput.from({ ...body, requestId: change.key }), now);
    if (op === 'edit') return this.update(UpdateAgentInput.from(id, { ...body, version }));
    return this.toggle(id, version, op === 'pause');
  }

  private async toggle(id: string, version: number, pause: boolean): Promise<Agent> {
    const agent = await new AgentRepository(this.tx).lock(this.spaceId, id);
    agent.assertVersion(version);
    if (pause) agent.pause();
    else agent.resume();
    return agent;
  }

  private runner(id: string) {
    return new RunnerRepository(this.tx).load(this.spaceId, id);
  }

  /** 허락할 외부 도구가 공간에 있는가 (2차 7단계). 없는 이름이 있으면 422 */
  private async assertKnownTools(names: readonly string[] | undefined): Promise<void> {
    const missing = names?.length
      ? await new ExternalToolRepository(this.tx).missing(this.spaceId, names)
      : [];
    if (missing.length > 0) throw new RuleViolation(`없는 외부 도구예요: ${missing.join(', ')}`);
  }
}
