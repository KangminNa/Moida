import type { ApprovalRow } from '../task.tables';

/** 기다리는 결재 한 줄: 결재와 그 결재를 올린 작업의 제목 (결과 카드는 대화의 제목) */
export interface InboxApprovalRow
  extends Pick<ApprovalRow, 'id' | 'action' | 'note' | 'target_id' | 'created_at'> {
  title: string | null;
}

/**
 * inbox의 답 (브라우저 확장의 배지, 2차 4단계): 기다리는 결재의 수와 최근 것 몇 개.
 * questions는 O-2에서 늘 비어 있다 (맡을 에이전트를 묻는 질문을 없앴다. 확장이 읽어 모양만 둔다, O-3에서 지운다).
 * 주소(link)는 콘솔 안의 경로다 (확장이 블로그 주소에 붙여 연다). 결재는 콘솔에서만 한다
 */
export class InboxView {
  constructor(
    private readonly approvals: readonly InboxApprovalRow[],
    private readonly approvalCount: number,
    /** 결과 카드의 동작 (대화로 가는 주소) */
    private readonly cardAction: string,
  ) {}

  toJSON() {
    return {
      total: this.approvalCount,
      approvals: {
        count: this.approvalCount,
        items: this.approvals.map((a) => ({
          id: a.id,
          action: a.action,
          title: a.title ?? a.note ?? a.action,
          created_at: a.created_at.toISOString(),
          link:
            a.action === this.cardAction
              ? `/admin/chats/${a.target_id}`
              : `/admin/approvals/${a.id}`,
        })),
      },
      questions: { count: 0, items: [] },
    };
  }
}
