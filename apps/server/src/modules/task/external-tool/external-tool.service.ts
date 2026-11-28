import { Injectable } from '@nestjs/common';
import {
  Actor,
  AgentActor,
  Conflict,
  Database,
  EntityService,
  Forbidden,
  Idempotency,
  RuleViolation,
  SecretBox,
  SettingActor,
  type SettingChangeInput,
  SettingOutcome,
  type Sql,
} from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { SettingChanges } from '../setting-change/setting-change.policy';
import { ConnectorEdit } from './connector-edit';
import { ConnectorPresets } from './connector-preset.policy';
import { ExternalTool } from './external-tool';
import type {
  AddPresetInput,
  CreateExternalToolInput,
  ExternalToolSecretInput,
  PlugDecisionInput,
  ProposeToolInput,
  RemoveExternalToolInput,
  UpdateExternalToolInput,
} from './external-tool.input';
import { ExternalToolRepository } from './external-tool.repository';

// 외부 도구 쓰기 (2차 7단계). 관리 일은 assertOwner(), 제안은 작업 토큰(AgentActor)으로.
// 예외 (객체설계 4장): 도구를 붙이고 떼는 일은 에이전트의 허락 목록(agents.external_tools)과 한 트랜잭션이라
// 이 Service가 AgentRepository를 함께 쓴다 (승인한 제안이 켜졌는데 에이전트에는 안 붙는 반쪽이 남지 않게). 잠그는 순서는 도구 → 에이전트.
@Injectable()
export class ExternalToolService extends EntityService<ExternalTool> {
  private static readonly CREATE = 'create_external_tool';
  private static readonly PROPOSE = 'propose_tool';
  private static readonly PLUG = 'plug_external_tool';

  constructor(
    db: Database,
    private readonly box: SecretBox,
  ) {
    super(db);
  }

  protected store(tx: Sql): ExternalToolRepository {
    return new ExternalToolRepository(tx);
  }

  /** 관리자가 더한다: 바로 쓴다. 같은 requestId가 다시 오면 처음 만든 것을 돌려준다 */
  async create(actor: Actor, req: CreateExternalToolInput): Promise<ExternalTool> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const secret = req.secret === null ? null : this.box.seal(ExternalTool.secretOf(req.secret));
    return this.transaction(async (tx) => {
      const tools = this.store(tx);
      const once = new Idempotency(
        tx,
        actor.id ?? spaceId,
        req.requestId,
        ExternalToolService.CREATE,
      );
      const before = await once.previous();
      if (before) return tools.load(spaceId, String(before.id));
      const now = new Date();
      const tool = ExternalTool.open(spaceId, req.name, req.fields, now);
      if (secret) tool.setSecret(secret, now);
      await tools.save(tool);
      await once.remember({ id: tool.id });
      return tool;
    });
  }

  /**
   * 추천 커넥터 더하기 (C2): 목록의 칸으로 만들고 지우지 않은 모든 에이전트(대표 포함)에게 허락한다 (허락할 자리가 남은
   * 에이전트만, AgentScopes). 같은 이름이 있으면 409, 같은 requestId는 처음 만든 것. 토큰 · 로그인은 그 뒤 목록에서.
   * 잠그는 순서는 도구 → 에이전트
   */
  async addPreset(actor: Actor, req: AddPresetInput): Promise<ExternalTool> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const preset = ConnectorPresets.find(req.key);
    return this.transaction(async (tx) => {
      const tools = this.store(tx);
      const owner = actor.id ?? spaceId;
      const once = new Idempotency(tx, owner, req.requestId, ExternalToolService.CREATE);
      const before = await once.previous();
      if (before) return tools.load(spaceId, String(before.id));
      if ((await tools.missing(spaceId, [preset.name])).length === 0)
        throw new Conflict(`같은 이름의 커넥터가 있어요: ${preset.name}`);
      const now = new Date();
      const tool = ExternalTool.open(spaceId, preset.name, ConnectorPresets.fields(preset), now);
      await tools.save(tool);
      const agents = new AgentRepository(tx);
      for (const agent of await agents.lockAll(spaceId)) {
        // 대표는 커넥터를 쓰지 않는다 (맡기기만, 고치는 칸은 AgentLead.assertEdit). 일꾼에게만
        if (agent.lead || agent.toolProblem(preset.name) !== null) continue;
        agent.plugTool(preset.name);
        await agents.save(agent);
      }
      await once.remember({ id: tool.id });
      return tool;
    });
  }

  /** 칸 · 켜기 · 끄기. 본 version이 지금과 다르면 409 */
  update(actor: Actor, req: UpdateExternalToolInput): Promise<ExternalTool> {
    return this.changeAsOwner(actor, req, (tool) => {
      const now = new Date();
      tool.edit(req.changes, now);
      if (req.enabled !== null) tool.switchTo(req.enabled, now);
    });
  }

  /** 설정 바꾸기 제안의 미리 해 보기 (C4 커넥터 켜기 · 끄기): 같은 줄을 지나고 저장하지 않는다 */
  async rehearseSetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingActor.spaceOf(actor);
    await this.transaction(async (tx) => {
      await new ConnectorEdit(tx, spaceId).apply(change, new Date());
    });
  }

  /** 승인한 커넥터 설정 바꾸기: 결재마다 한 번 적용하고 결과(task.setting.changed)를 남긴다 */
  async applySetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingOutcome.spaceOf(actor, change.key);
    await SettingOutcome.settle(
      (work) => this.transaction(work),
      SettingChanges.TOPIC,
      spaceId,
      change.key,
      async (tx) => {
        await new ExternalToolRepository(tx).save(
          await new ConnectorEdit(tx, spaceId).apply(change, new Date()),
        );
      },
    );
  }

  /** 토큰을 넣거나 바꾼다. 값은 여기서 잠그고 어디에도 다시 내보내지 않는다 */
  setSecret(actor: Actor, req: ExternalToolSecretInput): Promise<ExternalTool> {
    const sealed = this.box.seal(ExternalTool.secretOf(req.secret));
    return this.changeAsOwner(actor, req, (tool) => tool.setSecret(sealed, new Date()));
  }

  /** 지운다. 허락한 에이전트에서도 뗀다 (같은 트랜잭션) */
  async remove(actor: Actor, req: RemoveExternalToolInput): Promise<void> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    await this.transaction(async (tx) => {
      const tools = this.store(tx);
      const tool = await tools.lock(spaceId, req.id);
      tool.assertVersion(req.version);
      const agents = new AgentRepository(tx);
      for (const agent of await agents.lockAll(spaceId)) {
        if (!agent.externalTools.includes(tool.name)) continue;
        agent.unplugTool(tool.name);
        await agents.save(agent);
      }
      await tools.remove(tool);
    });
  }

  /**
   * AI의 제안 (MCP propose_tool, 작업 토큰). proposed로 두고, AI는 답의 id · version으로 결재(task.tool.plug)를 올린다.
   * 같은 request_id는 처음 제안을 돌려준다
   */
  async propose(actor: Actor, req: ProposeToolInput): Promise<ExternalTool> {
    if (!(actor instanceof AgentActor) || !actor.spaceId) throw new Forbidden(Actor.AGENT);
    const { agentId } = actor;
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const tools = this.store(tx);
      const once = new Idempotency(tx, agentId, req.requestId, ExternalToolService.PROPOSE);
      const before = await once.previous();
      if (before) return tools.load(spaceId, String(before.id));
      const tool = ExternalTool.propose(spaceId, agentId, req.name, req.fields, new Date());
      await tools.save(tool);
      await once.remember({ id: tool.id });
      return tool;
    });
  }

  /**
   * 결재(task.tool.plug)가 정해졌다 (ExternalToolPlugHandler). 승인이면 켜고 제안한 에이전트에 붙이고 결과(approvalId · outcome)를
   * 이벤트로 남긴다. 반려 · 수정 요청 · 취소면 제안을 지운다. 두 번 받아도 결과가 같다 (결재마다 한 번)
   */
  async decide(
    actor: Actor,
    spaceId: string,
    granted: boolean,
    req: PlugDecisionInput,
  ): Promise<void> {
    actor.assertOwnerOrSystem();
    await this.transaction(async (tx) => {
      const tools = this.store(tx);
      const once = new Idempotency(tx, spaceId, req.approvalId, ExternalToolService.PLUG);
      if (await once.previous()) return;
      const tool = await tools.lockOrNull(spaceId, req.toolId);
      if (!granted) {
        if (tool?.proposed) await tools.remove(tool);
      } else {
        const agents = new AgentRepository(tx);
        const agent = req.agentId ? await agents.lockOrNull(spaceId, req.agentId) : null;
        const result = tool
          ? tool.plugApproved(req.approvalId, req.targetVersion, agent, new Date())
          : ExternalTool.failed(spaceId, req.toolId, req.approvalId, '제안한 도구를 지웠어요');
        if (tool && result.data.outcome === 'done') {
          if (agent) await agents.save(agent);
          await tools.save(tool);
        }
        await tools.announce(result);
      }
      await once.remember({ granted });
    });
  }

  /** 서버 키를 바꾼 뒤 지금 키로 다시 잠근다 (SecretRotation에 등록). 다시 잠근 수 */
  async resealSecrets(actor: Actor): Promise<number> {
    actor.assertOwnerOrSystem();
    return this.transaction(async (tx) => {
      const tools = this.store(tx);
      let count = 0;
      for (const tool of await tools.lockSealed()) {
        if (!tool.reseal(this.box)) continue;
        await tools.save(tool);
        count += 1;
      }
      return count;
    });
  }
}
