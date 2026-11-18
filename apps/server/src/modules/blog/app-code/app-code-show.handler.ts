import { Injectable } from '@nestjs/common';
import { ApprovedActor, BaseHandler, type DomainEvent } from '../../platform';
import { ApprovedPublishInput } from '../post/post.input';
import { AppCode } from './app-code';
import { AppCodeService } from './app-code.service';

// 대화의 결과 카드에서 승인한 앱 코드 공개를 실행한다 (스토어 1-6b). 다른 동작의 승인은 그 동작을 가진 곳의 일이라 넘어간다.
// 결재의 대상은 앱, 판은 버전 번호다. 두 번 받아도 결과가 같다 (이미 보이면 그대로).
// 작업에 묶이지 않은 결재라 실행 결과를 task에 돌려주지 않는다
@Injectable()
export class AppCodeShowHandler extends BaseHandler {
  static readonly TOPIC = 'task.approval.granted';

  constructor(private readonly codes: AppCodeService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (event.data.action !== AppCode.SHOW_ACTION) return;
    const req = ApprovedPublishInput.from(event.data);
    await this.codes.showApproved(
      new ApprovedActor(event.spaceId, req.decidedBy, req.approvalId, req.action),
      req.targetId,
      req.targetVersion,
    );
  }
}
