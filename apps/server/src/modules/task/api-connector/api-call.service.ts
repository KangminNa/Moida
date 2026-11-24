import { Injectable } from '@nestjs/common';
import {
  Actor,
  AgentActor,
  Database,
  DomainEvent,
  EntityService,
  Forbidden,
  NotFound,
  SecretBox,
  type Sql,
} from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { ApprovalRepository } from '../approval/approval.repository';
import { TaskRepository } from '../task/task.repository';
import type { ApiCallHeldReason } from '../task.tables';
import { ApiApproval } from './api-approval.policy';
import { ApiCall, type ApiCaller } from './api-call';
import { ApiCallGateway } from './api-call.gateway';
import { ApiCallRepository } from './api-call.repository';
import type { ApiConnector } from './api-connector';
import type { ApiDecisionInput, ApiRunInput, TryApiInput } from './api-connector.input';
import { ApiConnectorRepository } from './api-connector.repository';
import type { ApiOperation } from './api-operation.policy';

/** 부르기를 열 때 정한 것 (트랜잭션 밖에서 보낼지) */
class Opened {
  constructor(
    readonly call: ApiCall,
    readonly fresh: boolean,
  ) {}
}

// API 부르기 (2026-11-24). 일꾼의 api_run · 관리자의 시험 · 승인 뒤 부르기 · 일꾼(ApiCallJob)의 상태 묻기와 파일 받기.
// 요청은 트랜잭션 밖에서 보내고(ApiCallGateway), 결과는 짧은 트랜잭션에서 적는다. 키는 여기서만 푼다 (ApiConnector.headers).
// 바깥에 남기는 동작(write) · 하루 한도를 넘은 돈이 드는 동작(spend)은 열면서 결재(task.api.call)를 올리고 기다린다.
// 관리자의 시험은 관리자가 누른 것이 승인이라 기다리지 않는다. 잠그는 순서는 작업 → 커넥터 → 부르기 → 결재
@Injectable()
export class ApiCallService extends EntityService<ApiCall> {
  /** 일꾼이 한 번에 맡는 부르기 수 · 맡은 뒤 다음 차례까지 */
  private static readonly BATCH = 20;
  private static readonly CLAIM_MS = 10 * 60_000;

  constructor(
    db: Database,
    private readonly box: SecretBox,
    private readonly gateway: ApiCallGateway,
  ) {
    super(db);
  }

  protected store(tx: Sql): ApiCallRepository {
    return new ApiCallRepository(tx);
  }

  /** 일꾼 (MCP api_run). 같은 request_id(작업마다)는 처음 부르기를 돌려준다 */
  async run(actor: Actor, req: ApiRunInput): Promise<ApiCall> {
    if (!(actor instanceof AgentActor) || !actor.spaceId) throw new Forbidden(Actor.AGENT);
    const { spaceId, agentId, taskId } = actor;
    const opened = await this.open(spaceId, `${taskId}:${req.requestId}`, req, {
      taskId,
      runId: null,
      agentId,
    });
    return opened.fresh && opened.call.status === 'running'
      ? this.send(spaceId, opened.call.id)
      : opened.call;
  }

  /** 관리자의 시험 (콘솔). 결과물은 작업 없이 남는다 */
  async tryOut(actor: Actor, req: TryApiInput): Promise<ApiCall> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const opened = await this.open(spaceId, `owner:${req.requestId}`, req, {
      taskId: null,
      runId: null,
      agentId: null,
    });
    return opened.fresh && opened.call.status === 'running'
      ? this.send(spaceId, opened.call.id)
      : opened.call;
  }

  /** 결재(task.api.call)가 정해졌다 (ApiDecisionHandler). 승인이면 한 번 부르고 기다리던 작업을 잇는다 */
  async decide(
    actor: Actor,
    spaceId: string,
    granted: boolean,
    req: ApiDecisionInput,
  ): Promise<void> {
    actor.assertOwnerOrSystem();
    const now = new Date();
    const call = await this.transaction(async (tx) => {
      const calls = this.store(tx);
      const held = await calls.lockHeld(spaceId, req.approvalId);
      if (!held) return null;
      if (!granted) {
        held.refuse(req.approvalId, now);
        await calls.save(held);
        return null;
      }
      if (!held.approve(req.approvalId, now)) return null;
      await calls.save(held);
      return held;
    });
    if (!call) return;
    await this.send(spaceId, call.id);
    await this.transaction(async (tx) =>
      this.store(tx).announce(
        new DomainEvent('task.api_call.ran', 1, spaceId, {
          callId: call.id,
          approvalId: req.approvalId,
          outcome: 'continue',
        }),
      ),
    );
  }

  /** 일꾼: 때가 된 상태 묻기를 한다. 파일 받을 차례인 부르기는 맡아서(claim) 돌려준다 (받기는 ApiCallJob이) */
  async due(actor: Actor, now: Date): Promise<readonly ApiCall[]> {
    actor.assertOwnerOrSystem();
    const claimed = await this.transaction(async (tx) => {
      const calls = this.store(tx);
      const due = await calls.due(now, ApiCallService.BATCH);
      for (const c of due) {
        c.claim(now, ApiCallService.CLAIM_MS);
        await calls.save(c);
      }
      return due;
    });
    const fetching: ApiCall[] = [];
    for (const call of claimed) {
      if (call.status === 'fetching') fetching.push(call);
      else await this.poll(call, now);
    }
    return fetching;
  }

  /** 일꾼: 받은 파일(결과물 id)과 받지 못한 까닭을 적는다 */
  async filesKept(
    actor: Actor,
    call: ApiCall,
    outputIds: readonly string[],
    errors: readonly string[],
  ): Promise<void> {
    actor.assertOwnerOrSystem();
    await this.transaction(async (tx) => {
      const calls = this.store(tx);
      const fresh = await calls.lock(call.spaceId, call.id);
      if (fresh.status !== 'fetching') return;
      fresh.filesKept(outputIds, errors, new Date());
      await calls.save(fresh);
    });
  }

  /** 일꾼: 다음에 깰 시각 */
  nextDue(actor: Actor): Promise<Date | null> {
    actor.assertOwnerOrSystem();
    return new ApiCallRepository(this.db.sql).nextDue();
  }

  /** 부르기를 연다: 커넥터 · 동작 · 입력을 보고, 쓰기 · 한도를 넘은 것은 결재를 올린다 */
  private async open(
    spaceId: string,
    requestId: string,
    req: { operation: string; input: Readonly<Record<string, unknown>> } & (
      | { connector: string }
      | { id: string }
    ),
    caller: ApiCaller,
  ): Promise<Opened> {
    const now = new Date();
    return this.transaction(async (tx) => {
      const calls = this.store(tx);
      const before = await calls.byRequest(spaceId, requestId);
      if (before) return new Opened(before, false);
      const tasks = new TaskRepository(tx);
      const task = caller.taskId ? await tasks.lock(spaceId, caller.taskId) : null;
      const connectors = new ApiConnectorRepository(tx);
      const connector =
        'connector' in req
          ? await connectors.lockByName(spaceId, req.connector)
          : await connectors.lock(spaceId, req.id);
      if (!connector)
        throw new NotFound(`없는 커넥터예요: ${'connector' in req ? req.connector : req.id}`);
      connector.assertReady(this.box);
      const op = connector.spec().operation(req.operation);
      const input = op.inputOf(req.input);
      const held = task ? await this.heldReason(calls, connector, op, now) : null;
      const runId = caller.taskId ? await calls.runOf(caller.taskId) : null;
      const call = ApiCall.open(connector, op, { ...caller, runId }, requestId, input, held, now);
      await calls.save(call);
      if (held && task && caller.agentId) {
        const agent = await new AgentRepository(tx).load(spaceId, caller.agentId);
        const approval = ApiApproval.call(
          task,
          agent,
          connector,
          call,
          op,
          now,
          await tasks.chatOf(task.id),
        );
        call.waitFor(approval.id);
        await calls.save(call);
        await tasks.save(task);
        await new ApprovalRepository(tx).save(approval);
      }
      return new Opened(call, true);
    });
  }

  /** 승인을 기다려야 하는 까닭: 바깥에 남기는 동작 · 하루 한도를 넘은 돈이 드는 동작 */
  private async heldReason(
    calls: ApiCallRepository,
    connector: ApiConnector,
    op: ApiOperation,
    now: Date,
  ): Promise<ApiCallHeldReason | null> {
    if (op.effect === 'write') return 'write';
    if (op.effect !== 'spend') return null;
    return (await calls.spentSince(connector.id, now)) >= connector.dailyMax ? 'limit' : null;
  }

  /** 첫 요청을 보내고 답을 적는다 (running인 부르기) */
  private async send(spaceId: string, callId: string): Promise<ApiCall> {
    const call = await new ApiCallRepository(this.db.sql).load(spaceId, callId);
    const connector = await new ApiConnectorRepository(this.db.sql).load(spaceId, call.connectorId);
    const spec = connector.spec();
    const op = spec.operation(call.operation);
    let answer: unknown = null;
    let error: string | null = null;
    try {
      answer = (
        await this.gateway.send(op.request(spec.base, call.input), connector.headers(this.box))
      ).body;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    return this.transaction(async (tx) => {
      const calls = this.store(tx);
      const fresh = await calls.lock(spaceId, callId);
      if (fresh.status !== 'running') return fresh;
      const now = new Date();
      if (error === null) fresh.answered(answer, op, now);
      else fresh.fail(error, now);
      await calls.save(fresh);
      await new ApiConnectorRepository(tx).noteUse(spaceId, connector.id, error, now);
      return fresh;
    });
  }

  /** 상태를 한 번 묻고 적는다 (polling인 부르기) */
  private async poll(call: ApiCall, now: Date): Promise<void> {
    let error: string | null = null;
    let answer: unknown = null;
    let op: ApiOperation | null = null;
    try {
      const connector = await new ApiConnectorRepository(this.db.sql).load(
        call.spaceId,
        call.connectorId,
      );
      const spec = connector.spec();
      op = spec.operation(call.operation);
      const req = op.pollRequest(spec.base, call.vars);
      if (!req) throw new Error('정의서에 상태 묻기가 없어요');
      answer = (await this.gateway.send(req, connector.headers(this.box))).body;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await this.transaction(async (tx) => {
      const calls = this.store(tx);
      const fresh = await calls.lock(call.spaceId, call.id);
      if (fresh.status !== 'polling') return;
      if (error !== null || !op)
        fresh.pollMissed(error ?? '정의서를 읽지 못했어요', op?.poll?.everySeconds ?? 10, now);
      else fresh.polled(answer, op, now);
      await calls.save(fresh);
    });
  }
}
