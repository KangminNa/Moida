import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { FlowEventInput } from './tidy.input';
import { TidyService } from './tidy.service';

// 끝난 요청의 작업 세션을 wiki 정리에 (S2, 기획서 결정 2026-11-17): 맨 위 작업이 끝나거나 결과 카드를 정하면
// 그 요청이 끝났는지 task에 묻고(platform Leases.settled), 끝났으면 그때까지의 판을 정리할 판으로 적는다.
// 두 번 와도 같다: 적은 판 번호는 앞으로만 가고, 정리 요청은 requestId로 하나다
@Injectable()
export class FlowSettledHandler extends BaseHandler {
  constructor(private readonly tidy: TidyService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    const input = FlowEventInput.from(event.name, event.data);
    await this.tidy.flowEnded(new SystemActor(), event.spaceId, input);
  }
}
