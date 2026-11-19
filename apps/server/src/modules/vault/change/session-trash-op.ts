import type { Session } from '../session/session';
import type { ChangeRow } from '../vault.tables';
import { ChangeOp, type TargetBoard } from './change-op';
import type { ChangeTarget, ChangeWork } from './change-target';

// 세션 휴지통 (2026-11-19 휴지통 A): 사람만 (관리 화면, ChangeOps.FOR_AI에 없다). wiki 휴지통과 같이 변경 묶음으로 남아
// 되돌릴 수 있다. 세션은 지우지 않고 휴지통에 둔다 (원칙 2): 판 · 원문 · 대표 wiki는 남아 되살리면 돌아온다

/** 세션을 휴지통으로 */
export class SessionTrashOp extends ChangeOp {
  static readonly NAME = 'session.trash';
  readonly name = SessionTrashOp.NAME;
  readonly targetKind = 'session';

  constructor(seq: number, targetId: string, baseVersion: number) {
    super(seq, targetId, baseVersion);
  }

  override recordAs(): ChangeRow['op'] {
    return 'delete';
  }

  apply(work: ChangeWork): ChangeTarget {
    const session = this.target as Session;
    session.trash(work);
    return session;
  }

  toPayload(): Record<string, unknown> {
    return {};
  }
}

/** 휴지통의 세션을 되살린다 */
export class SessionRestoreOp extends ChangeOp {
  static readonly NAME = 'session.restore';
  readonly name = SessionRestoreOp.NAME;
  readonly targetKind = 'session';

  constructor(seq: number, targetId: string, baseVersion: number) {
    super(seq, targetId, baseVersion);
  }

  /** 휴지통에 있는 대상이 이 변경의 대상이다 */
  protected override attach(board: TargetBoard, place: string | null): void {
    super.attach(board, place);
    this.missing = this.target === null;
  }

  override recordAs(): ChangeRow['op'] {
    return 'restore';
  }

  apply(work: ChangeWork): ChangeTarget {
    const session = this.target as Session;
    session.untrash(work);
    return session;
  }

  toPayload(): Record<string, unknown> {
    return {};
  }
}
