import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { BaseQuery } from '../base/base-query';
import { Rule } from '../base/table-query';
import { outbox } from '../platform.schema';
import { FailedEventListView } from './failed-event.view';

// 멈춘 이벤트 읽기 (관리자 · 명령줄). 관리자는 자기 공간, 명령줄은 모두.
@Injectable()
export class FailedEventQuery extends BaseQuery {
  private static readonly SHOWN = 50;

  /** 최근에 멈춘 것부터 50개 */
  async list(actor: Actor): Promise<FailedEventListView> {
    actor.assertOwnerOrSystem();
    const rows = await this.rows(
      outbox,
      { space_id: Rule.maybe(actor.spaceId), failed_at: Rule.set },
      { order: ['failed_at desc', 'id desc'], limit: FailedEventQuery.SHOWN },
    );
    return new FailedEventListView(rows);
  }
}
