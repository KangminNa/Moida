import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { BaseQuery } from '../base/base-query';
import type { SecurityEventRow } from '../platform.tables';
import { SecurityEventsInput } from './security-event.input';
import { SecurityEventPageView } from './security-event.view';

// 보안 기록 읽기 (관리자만). 공간을 모르는 사건(space_id NULL: 없는 아이디로 로그인, 로그인 전 거부)도 함께 본다:
// 서버에 공간이 하나라 그 사건은 이 관리자의 것이다.
@Injectable()
export class SecurityEventQuery extends BaseQuery {
  async page(actor: Actor, req: SecurityEventsInput): Promise<SecurityEventPageView> {
    actor.assertOwner();
    const space = actor.requireSpace();
    const rows = await this.sql<SecurityEventRow[]>`
      SELECT * FROM platform.security_events
      WHERE (space_id = ${space} OR space_id IS NULL)
        ${req.group ? this.sql`AND kind LIKE ${`${req.group}.%`}` : this.sql``}
        ${req.before ? this.sql`AND (at, id) < (${req.before[0]}, ${req.before[1]}::uuid)` : this.sql``}
      ORDER BY at DESC, id DESC
      LIMIT ${SecurityEventsInput.PAGE + 1}`;
    const { items, next } = this.pageOf(rows, SecurityEventsInput.PAGE, (last) =>
      SecurityEventsInput.cursorAfter(last.at, last.id),
    );
    return new SecurityEventPageView(items, next);
  }
}
