import { Injectable } from '@nestjs/common';
import {
  Actor,
  AgentActor,
  BaseService,
  Database,
  Forbidden,
  Idempotency,
  RuleViolation,
  type SettingChangeInput,
  SettingKinds,
  SettingOutcome,
} from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { Approval } from '../approval/approval';
import { ApprovalRepository } from '../approval/approval.repository';
import { TaskRepository } from '../task/task.repository';
import type { ProposeSettingInput } from './setting-change.input';
import { SettingChanges } from './setting-change.policy';
import { SettingQuery } from './setting-change.query';

// 설정 바꾸기 제안 (2026-11-15 C · D, MCP propose_setting): 그 설정을 가진 모듈(platform SettingKinds)에 지금 값을 묻고,
// 바뀐 줄을 만들고, 관리자의 고치기와 같은 줄로 미리 해 보게 한 뒤(저장하지 않는다) 결재 task.setting.change 하나로 올린다.
// 바뀔 값은 결재의 payload에 실린다. 작업은 결재를 기다리고, 대화의 일이면 결과 카드에 실린다.
// 적용은 승인 뒤에 그 설정을 가진 모듈이 한다 (SettingApplyHandler → SettingKind.apply).
// 미리 해 보기는 그 모듈의 트랜잭션이라 결재를 쓰는 트랜잭션 밖에서 한다. 같은 request_id가 겹치면 트랜잭션 안에서 다시 본다.
// 같은 모듈의 여러 묶음 (객체설계 4장): 결재 · 작업을 함께 쓰고 에이전트는 읽기만. 잠그는 순서는 작업 → 결재 → 에이전트
@Injectable()
export class SettingChangeService extends BaseService {
  private static readonly PROPOSE = 'propose_setting';
  /** 승인했는데 그 설정을 다루는 모듈이 없다 (패키지를 껐거나 지웠다) */
  private static readonly UNHANDLED = '이 설정을 다루는 곳이 없어요 (기능을 껐거나 지웠어요)';

  constructor(
    db: Database,
    private readonly settings: SettingQuery,
    private readonly kinds: SettingKinds,
  ) {
    super(db);
  }

  /** 같은 request_id는 처음 결재 (작업마다 센다) */
  async propose(actor: Actor, req: ProposeSettingInput): Promise<Approval> {
    if (!(actor instanceof AgentActor) || !actor.spaceId) throw new Forbidden(Actor.AGENT);
    const { spaceId, agentId, taskId } = actor;
    const reader = await this.settings.reader(actor);
    const earlier = await this.earlier(spaceId, taskId, req.requestId);
    if (earlier) return earlier;
    const kind = this.kinds.of(req.setting);
    if (!kind) throw new RuleViolation(SettingChangeService.UNHANDLED);
    const fields = kind.normalize?.(req.fields) ?? req.fields;
    const draft = req.change(fields, []);
    const now = await kind.current(reader, draft);
    const changes = req.switching
      ? SettingChanges.switched(now, req.op)
      : SettingChanges.diff(kind, now, fields, (f) => kind.labelOf?.(f, draft) ?? null);
    if (changes.length === 0) throw new RuleViolation('바뀌는 칸이 없어요 (지금 값과 같아요)');
    const change = req.change(kind.bodyOf?.(fields, now) ?? fields, changes);
    await kind.rehearse(reader, change);
    const at = new Date();
    return this.transaction(async (tx) => {
      const approvals = new ApprovalRepository(tx);
      const once = new Idempotency(tx, taskId, req.requestId, SettingChangeService.PROPOSE);
      const done = await once.previous();
      if (done) return approvals.load(spaceId, String(done.approvalId));
      const tasks = new TaskRepository(tx);
      const task = await tasks.lock(spaceId, taskId);
      const proposer = await new AgentRepository(tx).load(spaceId, agentId);
      const approval = Approval.request(
        task,
        proposer,
        req.approvalFields(spaceId),
        at,
        await tasks.chatOf(taskId),
        // 이어서 하기(O-2)는 대표의 제안만: 팀장 · 팀원이 보내면 무시한다
        { ...change.payload(), ...(req.continues && proposer.lead ? { continue: true } : {}) },
      );
      await tasks.save(task);
      await approvals.save(approval);
      await once.remember({ approvalId: approval.id });
      return approval;
    });
  }

  /** 승인했는데 그 설정을 다루는 모듈이 없으면 결재를 실패로 끝낸다 (기다리던 작업이 멈춰 있지 않게) */
  async unhandled(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingOutcome.spaceOf(actor, change.key);
    await SettingOutcome.settle(
      (work) => this.transaction(work),
      SettingChanges.TOPIC,
      spaceId,
      change.key,
      async () => {
        throw new RuleViolation(SettingChangeService.UNHANDLED);
      },
    );
  }

  /**
   * 이미 올린 같은 request_id의 결재 (미리 해 보기 전에 본다: 그사이 적용됐으면 바뀌는 칸이 없다).
   * 보기만 한다 (peek): 자리는 결재를 쓰는 트랜잭션의 previous()가 잡는다
   */
  private earlier(spaceId: string, taskId: string, requestId: string): Promise<Approval | null> {
    return this.transaction(async (tx) => {
      const done = await new Idempotency(
        tx,
        taskId,
        requestId,
        SettingChangeService.PROPOSE,
      ).peek();
      return done ? new ApprovalRepository(tx).load(spaceId, String(done.approvalId)) : null;
    });
  }
}
