import {
  type Actor,
  ApprovedActor,
  Conflict,
  DomainError,
  DomainEvent,
  Forbidden,
  Idempotency,
  Outbox,
  type Sql,
} from '../../platform';
import { Approval } from '../approval/approval';

/**
 * 승인한 설정 바꾸기의 끝 (2026-11-15 C). 결재마다 한 번(Idempotency)만 적용하고 결과를 이벤트로 남긴다:
 * task.setting.changed { approvalId, outcome: done · failed, error? } → ApprovalResultHandler가 결재 · 기다리던 작업을 끝낸다.
 * 적용과 결과는 한 트랜잭션이다. 적용이 규칙에 막히면(DomainError) 되돌리고 실패를 따로 남긴다 (조용히 덮지 않는다)
 */
export class SettingOutcome {
  static readonly TOPIC = 'task.setting.changed';
  private static readonly ONCE = 'setting_change';
  /** 승인한 뒤 대상이 바뀌었다 (본 버전이 낡았다) */
  private static readonly CHANGED = '승인한 뒤 바뀐 설정이에요. 다시 제안해요';

  private constructor(
    private readonly tx: Sql,
    private readonly spaceId: string,
    private readonly approvalId: string,
  ) {}

  /** 승인으로 대신 실행하는가 (그 결재의 설정 바꾸기만). 공간을 돌려준다 */
  static spaceOf(actor: Actor, approvalId: string): string {
    if (
      !(actor instanceof ApprovedActor) ||
      actor.approvalId !== approvalId ||
      actor.action !== Approval.SETTING_CHANGE
    )
      throw new Forbidden(Approval.SETTING_CHANGE);
    return actor.requireSpace();
  }

  /** apply를 한 트랜잭션에서 한 번만. transaction은 부르는 Service의 것 */
  static async settle(
    transaction: (work: (tx: Sql) => Promise<void>) => Promise<void>,
    spaceId: string,
    approvalId: string,
    apply: (tx: Sql) => Promise<void>,
  ): Promise<void> {
    try {
      await transaction(async (tx) => {
        const outcome = new SettingOutcome(tx, spaceId, approvalId);
        if (await outcome.settled()) return;
        await apply(tx);
        await outcome.close(null);
      });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      const reason = error instanceof Conflict ? SettingOutcome.CHANGED : error.message;
      await transaction(async (tx) => {
        const outcome = new SettingOutcome(tx, spaceId, approvalId);
        if (!(await outcome.settled())) await outcome.close(reason);
      });
    }
  }

  private once(): Idempotency {
    return new Idempotency(this.tx, this.spaceId, this.approvalId, SettingOutcome.ONCE);
  }

  private async settled(): Promise<boolean> {
    return (await this.once().previous()) !== null;
  }

  private async close(error: string | null): Promise<void> {
    await new Outbox(this.tx).publish([
      new DomainEvent(SettingOutcome.TOPIC, 1, this.spaceId, {
        approvalId: this.approvalId,
        outcome: error === null ? 'done' : 'failed',
        ...(error === null ? {} : { error }),
      }),
    ]);
    await this.once().remember({ error });
  }
}
