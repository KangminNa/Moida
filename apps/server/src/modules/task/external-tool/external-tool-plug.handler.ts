import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { ExternalTool } from './external-tool';
import { PlugDecisionInput } from './external-tool.input';
import { ExternalToolService } from './external-tool.service';

// 제안한 외부 도구의 결재(task.tool.plug)가 정해지면 (2차 7단계): 승인이면 켜고 제안한 에이전트에 붙인다,
// 반려 · 수정 요청 · 취소면 제안을 지운다. 다른 동작의 결재는 넘어간다. 두 번 받아도 결과가 같다 (결재마다 한 번).
// 승인의 결과(task.external_tool.plugged · plug_failed, approvalId · outcome)는 ApprovalResultHandler가 받아 작업을 끝낸다.
@Injectable()
export class ExternalToolPlugHandler extends BaseHandler {
  static readonly GRANTED = 'task.approval.granted';
  /** 받는 주제: 승인과 승인이 아닌 끝 (반려 · 수정 요청 · 취소) */
  static readonly TOPICS: readonly string[] = [
    ExternalToolPlugHandler.GRANTED,
    'task.approval.rejected',
    'task.approval.revision_requested',
    'task.approval.cancelled',
  ];

  constructor(private readonly tools: ExternalToolService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (event.data.action !== ExternalTool.PLUG) return;
    const granted = event.name === ExternalToolPlugHandler.GRANTED;
    await this.tools.decide(
      new SystemActor(),
      event.spaceId,
      granted,
      PlugDecisionInput.from(event.data),
    );
  }
}
