import { Injectable } from '@nestjs/common';
import {
  Actor,
  AgentActor,
  BaseService,
  Database,
  Forbidden,
  Idempotency,
  RuleViolation,
  type Sql,
} from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { AgentEdit } from '../agent/agent-edit';
import { Approval } from '../approval/approval';
import { ApprovalRepository } from '../approval/approval.repository';
import { ScheduleEdit } from '../schedule/schedule-edit';
import { TaskRepository } from '../task/task.repository';
import type { ProposeSettingInput } from './setting-change.input';
import { SettingChanges } from './setting-change.policy';
import { SettingQuery } from './setting-change.query';

// 설정 바꾸기 제안 (2026-11-15 C, MCP propose_setting): 바꿀 값을 관리자의 고치기와 같은 줄(AgentEdit · ScheduleEdit)로
// 미리 적용해 보고(저장하지 않는다) 결재 task.setting.change 하나로 올린다. 바뀔 값은 결재의 payload에 실린다.
// 작업은 결재를 기다리고, 대화의 일이면 결과 카드에 실린다. 적용은 승인 뒤에 그 설정을 가진 Service가 한다 (applyApproved).
// 같은 모듈의 여러 묶음 (객체설계 4장): 결재 · 작업을 함께 쓰고 에이전트 · 스케줄은 잠가서 읽기만. 잠그는 순서는 작업 → 결재 → 에이전트
@Injectable()
export class SettingChangeService extends BaseService {
  private static readonly PROPOSE = 'propose_setting';

  constructor(
    db: Database,
    private readonly settings: SettingQuery,
  ) {
    super(db);
  }

  /** 같은 request_id는 처음 결재 (작업마다 센다) */
  async propose(actor: Actor, req: ProposeSettingInput): Promise<Approval> {
    if (!(actor instanceof AgentActor) || !actor.spaceId) throw new Forbidden(Actor.AGENT);
    const { spaceId, agentId, taskId } = actor;
    const before = (await this.settings.before(actor, req.setting, req.targetId))?.toJSON() ?? null;
    const changes = req.switching
      ? SettingChanges.switched(before, req.op)
      : SettingChanges.diff(before, req.fields);
    if (changes.length === 0) throw new RuleViolation('바뀌는 칸이 없어요 (지금 값과 같아요)');
    const body = req.bodyOver(before);
    const now = new Date();
    return this.transaction(async (tx) => {
      const approvals = new ApprovalRepository(tx);
      const once = new Idempotency(tx, taskId, req.requestId, SettingChangeService.PROPOSE);
      const done = await once.previous();
      if (done) return approvals.load(spaceId, String(done.approvalId));
      const tasks = new TaskRepository(tx);
      const task = await tasks.lock(spaceId, taskId);
      const proposer = await new AgentRepository(tx).load(spaceId, agentId);
      SettingChanges.assertInside(proposer.scopes, proposer.externalTools);
      await this.rehearse(tx, spaceId, req, body, now);
      const approval = Approval.request(
        task,
        proposer,
        req.approvalFields(spaceId),
        now,
        await tasks.chatOf(taskId),
        { setting: req.setting, op: req.op, body, changes },
      );
      await tasks.save(task);
      await approvals.save(approval);
      await once.remember({ approvalId: approval.id });
      return approval;
    });
  }

  /** 미리 해 보기: 관리자의 고치기와 같은 줄을 지나고 저장하지 않는다 (규칙에 어긋나면 여기서 오류) */
  private async rehearse(
    tx: Sql,
    spaceId: string,
    req: ProposeSettingInput,
    body: object,
    now: Date,
  ): Promise<void> {
    const id = req.targetId ?? spaceId;
    const version = req.version ?? 0;
    if (req.setting === SettingChanges.AGENT)
      await new AgentEdit(tx, spaceId).apply(req.op, id, version, body, req.requestId, now);
    else await new ScheduleEdit(tx, spaceId).apply(req.op, id, version, body, req.requestId, now);
  }
}
