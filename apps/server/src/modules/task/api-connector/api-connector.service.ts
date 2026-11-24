import { Injectable } from '@nestjs/common';
import {
  Actor,
  AgentActor,
  Database,
  EntityService,
  Forbidden,
  Idempotency,
  SecretBox,
  type Sql,
  type VersionInput,
} from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { ApprovalRepository } from '../approval/approval.repository';
import { TaskRepository } from '../task/task.repository';
import { ApiApproval } from './api-approval.policy';
import { ApiCallRepository } from './api-call.repository';
import { ApiConnector } from './api-connector';
import type {
  ApiDecisionInput,
  ApiKeysInput,
  ProposeApiInput,
  UpdateApiConnectorInput,
} from './api-connector.input';
import { ApiConnectorRepository } from './api-connector.repository';
import type { ApiConnectorView, ProposedApiView } from './api-connector.view';
import { ApiSpec } from './api-spec.policy';

// API 커넥터 쓰기 (2026-11-24). 제안은 작업 토큰(AgentActor), 관리는 assertOwner(), 결재의 반영은 일꾼(SystemActor).
// 예외 (객체설계 4장): 제안과 그 결재는 한 트랜잭션이라 설정 바꾸기 제안(SettingChangeService)처럼 작업 · 에이전트 · 결재의
// Repository를 함께 쓴다 (결재 없이 제안만 남는 반쪽이 없게). 잠그는 순서는 작업 → 커넥터 → 결재
@Injectable()
export class ApiConnectorService extends EntityService<ApiConnector> {
  private static readonly PROPOSE = 'propose_api';
  private static readonly DECIDE = 'decide_api_plug';

  constructor(
    db: Database,
    private readonly box: SecretBox,
  ) {
    super(db);
  }

  protected store(tx: Sql): ApiConnectorRepository {
    return new ApiConnectorRepository(tx);
  }

  /**
   * 일꾼의 제안 (MCP propose_api): 정의서를 거르고, 새 이름이면 새 커넥터(proposed), 있는 이름이면 그 커넥터의 새 버전.
   * 같은 트랜잭션에서 결재(task.api.plug)를 올리고 작업은 기다린다. 같은 request_id는 처음 제안을 돌려준다
   */
  async propose(actor: Actor, req: ProposeApiInput): Promise<ProposedApiView> {
    if (!(actor instanceof AgentActor) || !actor.spaceId) throw new Forbidden(Actor.AGENT);
    const { spaceId, agentId, taskId } = actor;
    const spec = ApiSpec.from(req.spec);
    const now = new Date();
    return this.transaction(async (tx) => {
      const connectors = this.store(tx);
      const once = new Idempotency(tx, taskId, req.requestId, ApiConnectorService.PROPOSE);
      const before = await once.previous();
      if (before)
        return (await connectors.load(spaceId, String(before.id))).proposedView(
          String(before.approvalId),
        );
      const tasks = new TaskRepository(tx);
      const task = await tasks.lock(spaceId, taskId);
      const agent = await new AgentRepository(tx).load(spaceId, agentId);
      const existing = await connectors.lockByName(spaceId, req.name);
      const connector = existing ?? ApiConnector.propose(spaceId, agentId, req, spec, now);
      if (existing) existing.proposeRevision(spec, req.note, now);
      await connectors.save(connector);
      const approval = ApiApproval.plug(
        task,
        agent,
        connector,
        spec,
        req.note,
        now,
        await tasks.chatOf(taskId),
      );
      await tasks.save(task);
      await new ApprovalRepository(tx).save(approval);
      await once.remember({ id: connector.id, approvalId: approval.id });
      return connector.proposedView(approval.id);
    });
  }

  /**
   * 결재(task.api.plug)가 정해졌다 (ApiDecisionHandler). 승인이면 켜거나 새 버전으로 바꾸고 결과를 이벤트로 남긴다
   * (작업은 그 결과로 끝난다). 아니면 새 커넥터의 제안은 지우고 새 버전 제안은 버린다. 결재마다 한 번
   */
  async decide(
    actor: Actor,
    spaceId: string,
    granted: boolean,
    req: ApiDecisionInput,
  ): Promise<void> {
    actor.assertOwnerOrSystem();
    await this.transaction(async (tx) => {
      const connectors = this.store(tx);
      const once = new Idempotency(tx, spaceId, req.approvalId, ApiConnectorService.DECIDE);
      if (await once.previous()) return;
      const connector = await connectors.lockOrNull(spaceId, req.targetId);
      const now = new Date();
      if (!granted) {
        if (connector?.dropProposal(now)) await connectors.remove(connector);
        else if (connector) await connectors.save(connector);
      } else {
        const result = connector
          ? connector.plugApproved(req.approvalId, req.targetVersion, now)
          : ApiConnector.failed(spaceId, req.targetId, req.approvalId, '제안한 커넥터를 지웠어요');
        if (connector && result.data.outcome === 'done') await connectors.save(connector);
        await connectors.announce(result);
      }
      await once.remember({ granted });
    });
  }

  /** 관리자: 이름표 · 하루 한도 · 켜기 · 끄기 */
  async update(actor: Actor, req: UpdateApiConnectorInput): Promise<ApiConnectorView> {
    const c = await this.changeAsOwner(actor, req, (c) =>
      c.edit(req.changes, req.enabled, new Date()),
    );
    return this.viewOf(c);
  }

  /** 관리자: 머리글마다 키. 값은 여기서 잠그고 어디에도 다시 내보내지 않는다 */
  async setKeys(actor: Actor, req: ApiKeysInput): Promise<ApiConnectorView> {
    const c = await this.changeAsOwner(actor, req, (c) =>
      c.setKeys(req.keys, this.box, new Date()),
    );
    return this.viewOf(c);
  }

  /** 고친 뒤 화면의 한 줄 (최근 24시간 쓴 수와 함께) */
  private async viewOf(connector: ApiConnector): Promise<ApiConnectorView> {
    const spent = await new ApiCallRepository(this.db.sql).spentSince(connector.id, new Date());
    return connector.view(this.box, spent);
  }

  /** 관리자: 지운다 (부르기 기록도 함께) */
  async remove(actor: Actor, req: VersionInput): Promise<void> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    await this.transaction(async (tx) => {
      const connectors = this.store(tx);
      const connector = await connectors.lock(spaceId, req.id);
      connector.assertVersion(req.version);
      await connectors.remove(connector);
    });
  }

  /** 서버 키를 바꾼 뒤 지금 키로 다시 잠근다 (SecretRotation에 등록). 다시 잠근 수 */
  async resealSecrets(actor: Actor): Promise<number> {
    actor.assertOwnerOrSystem();
    return this.transaction(async (tx) => {
      const connectors = this.store(tx);
      let count = 0;
      for (const connector of await connectors.lockSealed()) {
        if (!connector.reseal(this.box)) continue;
        await connectors.save(connector);
        count += 1;
      }
      return count;
    });
  }
}
