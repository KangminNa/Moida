import { Injectable } from '@nestjs/common';
import { BaseDueJob, SystemActor } from '../../platform';
import { ApprovalQuery } from './approval.query';
import { ApprovalService } from './approval.service';

// 판단 승인의 기한 (L3, 2026-11-28): 확인 필요 판단에 기한(expires_at)까지 답이 없으면 추천안으로 승인하고 일을 잇는다.
// 마감 작업: 가장 이른 기한에 깬다. 기한은 결재가 생길 때(task.approval.requested) 생기므로 그때 다시 잰다
@Injectable()
export class DecisionLapseJob extends BaseDueJob {
  readonly name = 'task.decision_lapses';
  static readonly TOPIC = 'task.approval.requested';

  constructor(
    private readonly approvals: ApprovalService,
    private readonly query: ApprovalQuery,
  ) {
    super();
  }

  async run(now: Date): Promise<Date | null> {
    const system = new SystemActor();
    await this.approvals.lapse(system, await this.query.expired(system, now), now);
    return this.query.nextExpiry(system);
  }
}
