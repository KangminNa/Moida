import { Injectable } from '@nestjs/common';
import { ApprovedActor, BaseHandler, type DomainEvent } from '../../platform';
import { ApprovedPublishInput } from '../post/post.input';
import { Issue } from './issue';
import { IssueService } from './issue.service';

// 관리자가 승인한 호 발행(blog.issue.publish)을 받아 실행한다 (2차 6단계). 다른 동작의 승인은 넘어간다.
// 결과(blog.issue.published · publish_failed, approvalId · outcome)는 이벤트로 task에 간다. 두 번 받아도 결과가 같다.
@Injectable()
export class IssuePublishHandler extends BaseHandler {
  constructor(private readonly issues: IssueService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (event.data.action !== Issue.ACTION) return;
    const req = ApprovedPublishInput.from(event.data);
    await this.issues.publishApproved(
      new ApprovedActor(event.spaceId, req.decidedBy, req.approvalId, req.action),
      req.targetId,
      req.targetVersion,
    );
  }
}
