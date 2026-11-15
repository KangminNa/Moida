import { Injectable } from '@nestjs/common';
import { ApprovedActor, BaseHandler, type DomainEvent } from '../../platform';
import { Approval } from '../approval/approval';
import { ApprovedSettingInput } from '../setting-change/setting-change.input';
import { SettingChanges } from '../setting-change/setting-change.policy';
import { AgentService } from './agent.service';

// 승인한 에이전트 설정 바꾸기를 받아 적용한다 (2026-11-15 C). 다른 동작 · 스케줄의 바꾸기는 넘어간다.
// 적용 · 결과(task.setting.changed)는 AgentService.applyApproved가 결재마다 한 번. 두 번 받아도 결과가 같다
@Injectable()
export class AgentSettingHandler extends BaseHandler {
  static readonly TOPIC = 'task.approval.granted';

  constructor(private readonly agents: AgentService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (!ApprovedSettingInput.carries(event.data, SettingChanges.AGENT)) return;
    const req = ApprovedSettingInput.from(event.data);
    await this.agents.applyApproved(
      new ApprovedActor(event.spaceId, req.decidedBy, req.approvalId, Approval.SETTING_CHANGE),
      req,
    );
  }
}
