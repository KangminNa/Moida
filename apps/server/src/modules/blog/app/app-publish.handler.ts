import { Injectable } from '@nestjs/common';
import { ApprovedActor, BaseHandler, type DomainEvent } from '../../platform';
import { ApprovedPublishInput } from '../post/post.input';
import { App } from './app';
import { AppService } from './app.service';

// 관리자가 대화에서 요청한 배포를 실행한다 (2026-11-24, 원칙 7의 예외). task가 관리자의 말을 확인하고 바로 승인한 결재
// blog.app.publish만 받는다. payload의 범위가 ship이면 앱을 공개로 바꾸고, edit이면 할 일이 없다 (새 버전의 반영은 task가 코드 공개를
// 바로 승인해 AppCodeShowHandler가 한다). 작업에 묶이지 않은 결재라 결과를 task에 돌려주지 않는다. 두 번 받아도 같다
@Injectable()
export class AppPublishHandler extends BaseHandler {
  static readonly TOPIC = 'task.approval.granted';

  constructor(private readonly apps: AppService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (event.data.action !== App.PUBLISH_ACTION) return;
    const req = ApprovedPublishInput.from(event.data);
    const scope = (event.data.payload as { scope?: unknown } | null)?.scope;
    await this.apps.publishApproved(
      new ApprovedActor(event.spaceId, req.decidedBy, req.approvalId, req.action),
      req.targetId,
      scope === 'ship',
    );
  }
}
