import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery } from '../../platform';
import { Approval } from '../approval/approval';
import { type InboxApprovalRow, InboxView } from './inbox.view';

// 나를 기다리는 것 (MCP inbox, 권한 inbox, 2차 4단계): 결재 화면 목록과 같은 결재(대화의 결재는 빼고 결과 카드). 읽기만 한다.
// 맡을 에이전트를 묻는 질문은 O-2에서 없앴다 (상대는 늘 대표): 확장이 읽는 questions는 늘 비어 있다
@Injectable()
export class InboxQuery extends BaseQuery {
  /** 수 말고 함께 보이는 최근 것 */
  private static readonly ITEMS = 5;

  async inbox(actor: Actor): Promise<InboxView> {
    actor.assertCan(Actor.INBOX);
    const spaceId = actor.requireSpace();
    const approvals = await this.sql<(InboxApprovalRow & { total: number })[]>`
      SELECT a.id, a.action, a.note, a.target_id, a.created_at,
             coalesce(t.title, c.title) AS title, count(*) OVER ()::int AS total
      FROM task.approvals a
      LEFT JOIN task.tasks t ON t.id = a.task_id
      LEFT JOIN task.chats c ON a.action = ${Approval.CARD} AND c.id = a.target_id
      WHERE a.space_id = ${spaceId} AND a.chat_id IS NULL AND a.status = ${Approval.PENDING}
      ORDER BY a.id DESC LIMIT ${InboxQuery.ITEMS}`;
    return new InboxView(approvals, approvals[0]?.total ?? 0, Approval.CARD);
  }
}
