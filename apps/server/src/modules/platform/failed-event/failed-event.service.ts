import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { BaseService } from '../base/base-service';
import type { Sql } from '../base/database';
import { Notices } from '../notice/notices';
import { FailedEvent } from './failed-event';
import type { FailedEventInput } from './failed-event.input';
import { FailedEventRepository } from './failed-event.repository';
import type { FailedEventView } from './failed-event.view';

// 멈춘 이벤트를 다시 시도하게 돌린다 (관리자 · 명령줄, 리팩토링 R1).
// 같은 트랜잭션에서 일꾼을 깨우고, 공간에 멈춘 것이 더 없으면 "처리 실패" 알림을 읽음으로 돌린다.
@Injectable()
export class FailedEventService extends BaseService {
  /** 하나를 다시 시도. 없으면 404, 멈춘 것이 아니면 409 */
  async retry(actor: Actor, input: FailedEventInput): Promise<FailedEventView> {
    actor.assertOwnerOrSystem();
    return this.transaction(async (tx) => {
      const events = new FailedEventRepository(tx);
      const event = await events.lock(input.id, actor.spaceId);
      event.retry(new Date());
      await events.save(event);
      await FailedEventService.settleIfClear(tx, events, [event.spaceId]);
      return event.view();
    });
  }

  /** 멈춘 것을 모두 다시 시도 (명령줄의 --all). 돌린 수 */
  async retryAll(actor: Actor): Promise<number> {
    actor.assertOwnerOrSystem();
    return this.transaction(async (tx) => {
      const events = new FailedEventRepository(tx);
      const failed = await events.lockFailed(actor.spaceId);
      for (const event of failed) {
        event.retry(new Date());
        await events.save(event);
      }
      await FailedEventService.settleIfClear(tx, events, [
        ...new Set(failed.map((e) => e.spaceId)),
      ]);
      return failed.length;
    });
  }

  private static async settleIfClear(
    tx: Sql,
    events: FailedEventRepository,
    spaceIds: readonly string[],
  ): Promise<void> {
    for (const spaceId of spaceIds)
      if (!(await events.anyFailed(spaceId)))
        await new Notices(tx).settle(spaceId, FailedEvent.NOTICE_GROUP, new Date());
  }
}
