import { TableRepository } from '../../platform';
import { approvals } from '../task.schema';
import type { ApprovalRow } from '../task.tables';
import { Approval } from './approval';

// task.approvals ↔ Approval. 불러오기와 저장은 기반이 하고, 여기에는 찾는 SQL만 있다.
export class ApprovalRepository extends TableRepository<ApprovalRow, Approval> {
  protected readonly table = approvals;
  protected readonly noun = '승인 요청';

  protected toEntity(row: ApprovalRow): Approval {
    return Approval.restore(row);
  }

  /** 있을 수도 없을 수도 있을 때 (다른 모듈의 이벤트가 가리킨 결재) */
  async findIn(spaceId: string, id: string): Promise<Approval | null> {
    return this.maybeOne(await this.select(spaceId, id, false));
  }

  /** 대상이 기다리는 결재를 잠근다 (작업에 묶이지 않는 결재: 목표 실행) */
  async lockPendingFor(targetKind: string, targetId: string): Promise<Approval | null> {
    return this.findOne(
      { target_kind: targetKind, target_id: targetId, status: Approval.PENDING },
      { lock: true },
    );
  }

  /** 작업이 기다리는 결재를 잠근다 (작업 하나에 하나뿐이다) */
  async lockPending(taskId: string): Promise<Approval | null> {
    return this.findOne({ task_id: taskId, status: Approval.PENDING }, { lock: true });
  }

  /** 작업이 올려 승인받은 설정 바꾸기 중 이어서 하기로 한 마지막 것 (O-2, 승인 뒤 이어서). 없으면 null */
  async continuedBy(taskId: string): Promise<Approval | null> {
    const approved = await this.find(
      { task_id: taskId, action: Approval.SETTING_CHANGE, status: Approval.APPROVED },
      { order: ['id desc'] },
    );
    return approved.find((a) => a.continues) ?? null;
  }

  /** 대화의 기다리는 결과 카드 (대화마다 하나) */
  lockOpenCard(chatId: string): Promise<Approval | null> {
    return this.findOne(
      { action: Approval.CARD, target_id: chatId, status: Approval.PENDING },
      { lock: true },
    );
  }

  /**
   * 이 회차가 실린 결과 카드를 관리자가 이미 정했는가 (O-3). 정한 뒤 회차가 끝나도(카드에서 승인한 결재를 기다리던 회차)
   * 실을 것이 0이라 받을 것이 빠져 보이므로 다시 맡기지 않는다
   */
  async cardDecided(chatId: string, turn: number): Promise<boolean> {
    const [row] = await this.sql`
      SELECT 1 FROM task.approvals
      WHERE action = ${Approval.CARD} AND target_id = ${chatId} AND target_version = ${turn}
        AND status <> ${Approval.PENDING}
      LIMIT 1`;
    return row !== undefined;
  }

  /** 대화의 일에서 올라와 아직 카드에 실리지 않은 결재 (기다리는 것만, id 순서로 잠근다) */
  lockUncarded(chatId: string): Promise<readonly Approval[]> {
    return this.find(
      { chat_id: chatId, status: Approval.PENDING, card_id: null },
      { order: ['id'], lock: true },
    );
  }

  /** 이 대화에서 관리자가 그 앱의 배포 · 수정을 요청한 마지막 말 (since 뒤, AppApproval.ownerAsked). 없으면 null */
  async askedFor(chatId: string, appId: string, since: Date): Promise<string | null> {
    const [row] = await this.sql<{ quote: string | null }[]>`
      SELECT payload->>'quote' AS quote FROM task.approvals
      WHERE chat_id = ${chatId} AND action = ${Approval.PUBLISH_APP} AND target_id = ${appId}
        AND status = ${Approval.APPROVED} AND decided_at >= ${since}
      ORDER BY decided_at DESC LIMIT 1`;
    return row?.quote ?? null;
  }

  /** 이 대화에서 기다리는 그 앱의 코드 공개 중 아직 카드에 실리지 않은 것 (카드에 실린 것은 카드에서 정한다) */
  lockUncardedAppCode(chatId: string, appId: string): Promise<readonly Approval[]> {
    return this.find(
      {
        chat_id: chatId,
        action: Approval.APP_CODE_SHOW,
        target_id: appId,
        status: Approval.PENDING,
        card_id: null,
      },
      { order: ['id'], lock: true },
    );
  }

  /**
   * 같은 대상에 검수자가 고쳐 달라고 한 앞 결재들 (검수의 회수와 앞 의견, 2026-11-20 ChatInspect). 오래된 것부터.
   * 같은 대화 · 동작 · 대상이면 같은 일로 본다 (글은 고쳐 다시 올려도 같은 글, 앱 화면은 같은 앱)
   */
  inspectorFixes(approval: Approval): Promise<readonly Approval[]> {
    return this.find(
      {
        chat_id: approval.chatId,
        action: approval.action,
        target_id: approval.targetId,
        status: Approval.REVISION_REQUESTED,
        agent_decided: true,
      },
      { order: ['id'] },
    );
  }

  /** 카드에 실린 기다리는 결재 (읽기만: 작업을 먼저 잠근 뒤 lock으로 다시 잠근다) */
  inCard(cardId: string): Promise<readonly Approval[]> {
    return this.find({ card_id: cardId, status: Approval.PENDING }, { order: ['id'] });
  }
}
