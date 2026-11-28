import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, NotFound, Rule, ValueList } from '../../platform';
import { approvals } from '../task.schema';
import { APPROVAL_STATUS, type ApprovalRow } from '../task.tables';
import { Approval } from './approval';
import type { ApprovalIdInput, ListApprovalsInput } from './approval.input';
import { ApprovalPageView, ApprovalView } from './approval.view';

// 결재 읽기. 주인만 (앱 운영 팀을 부른 결재인지는 그 결재의 요청자, 스토어 2-6). 결재 화면은 target으로 대상 모듈의 API에서 실제 내용을 읽는다 (AI의 요약을 보여 주지 않는다).
@Injectable()
export class ApprovalQuery extends BaseQuery {
  private static readonly PAGE = 30;

  async list(actor: Actor, req: ListApprovalsInput): Promise<ApprovalPageView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    // 값 목록 밖의 상태에 맞는 결재는 없다 (CHECK)
    if (req.status !== null && !ValueList.has(APPROVAL_STATUS, req.status))
      return new ApprovalPageView([], null);
    const rows = await this.rows(
      approvals,
      {
        space_id: spaceId,
        // 대화의 일에서 올라온 결재는 결과 카드에서 정한다 (목록에는 카드가 보인다)
        chat_id: null,
        status: Rule.maybe(req.status),
        id: Rule.maybe(req.cursor, Rule.before),
      },
      { order: ['id desc'], limit: ApprovalQuery.PAGE + 1 },
    );
    const { items, next } = this.pageOf(rows, ApprovalQuery.PAGE, (last) => last.id);
    return new ApprovalPageView(
      items.map((r) => new ApprovalView(r)),
      next,
    );
  }

  /** 기한이 지난 기다리는 결재 (DecisionLapseJob). 공간 · 결재 id */
  async expired(actor: Actor, now: Date): Promise<readonly Pick<ApprovalRow, 'space_id' | 'id'>[]> {
    actor.assertOwnerOrSystem();
    return this.sql<Pick<ApprovalRow, 'space_id' | 'id'>[]>`
      SELECT space_id, id FROM task.approvals
      WHERE expires_at <= ${now} AND status = ${Approval.PENDING} AND expires_at IS NOT NULL
      ORDER BY expires_at LIMIT 50`;
  }

  /** 가장 이른 기다리는 결재의 기한. 없으면 null (결재가 생기는 신호로 다시 잰다) */
  async nextExpiry(actor: Actor): Promise<Date | null> {
    actor.assertOwnerOrSystem();
    const [row] = await this.sql<Pick<ApprovalRow, 'expires_at'>[]>`
      SELECT min(expires_at) AS expires_at FROM task.approvals
      WHERE status = ${Approval.PENDING} AND expires_at IS NOT NULL`;
    return row?.expires_at ?? null;
  }

  async get(actor: Actor, req: ApprovalIdInput): Promise<ApprovalView> {
    actor.assertOwner();
    const row = await this.row(approvals, { space_id: actor.requireSpace(), id: req.id });
    if (!row) throw new NotFound('승인 요청을 찾을 수 없어요');
    return new ApprovalView(row);
  }
}
