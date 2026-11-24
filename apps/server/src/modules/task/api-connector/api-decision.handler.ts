import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { ApiCall } from './api-call';
import { ApiCallService } from './api-call.service';
import { ApiConnector } from './api-connector';
import { ApiDecisionInput } from './api-connector.input';
import { ApiConnectorService } from './api-connector.service';

// API 커넥터의 결재가 정해지면 (2026-11-24). 두 번 받아도 결과가 같다 (결재마다 한 번).
//   task.api.plug: 승인이면 켜거나 새 버전으로, 아니면 제안을 버린다. 결과(task.api_connector.plugged · plug_failed)로 작업이 끝난다
//   task.api.call: 승인이면 한 번 부르고 기다리던 작업을 잇는다(task.api_call.ran, continue), 아니면 부르기를 refused로
@Injectable()
export class ApiDecisionHandler extends BaseHandler {
  static readonly GRANTED = 'task.approval.granted';
  /** 받는 주제: 승인과 승인이 아닌 끝 (반려 · 수정 요청 · 취소) */
  static readonly TOPICS: readonly string[] = [
    ApiDecisionHandler.GRANTED,
    'task.approval.rejected',
    'task.approval.revision_requested',
    'task.approval.cancelled',
  ];

  constructor(
    private readonly connectors: ApiConnectorService,
    private readonly calls: ApiCallService,
  ) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    const action = event.data.action;
    if (action !== ApiConnector.PLUG && action !== ApiCall.ACTION) return;
    const granted = event.name === ApiDecisionHandler.GRANTED;
    const req = ApiDecisionInput.from(event.data);
    if (action === ApiConnector.PLUG)
      await this.connectors.decide(new SystemActor(), event.spaceId, granted, req);
    else await this.calls.decide(new SystemActor(), event.spaceId, granted, req);
  }
}
