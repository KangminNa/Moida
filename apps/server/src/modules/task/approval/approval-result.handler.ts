import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { ApprovalResultInput } from './approval.input';
import { ApprovalService } from './approval.service';

// 결재한 동작의 실행 결과를 받아 작업을 끝낸다. 결과를 담는 주제(TOPICS)만 받고, 그 가운데서도 결과를 담은 것만 처리한다
// (결재 없이 사람이 한 공개처럼 approvalId가 없는 이벤트도 같은 주제로 온다). 두 번 받아도 결과가 같다.
// 주제 목록은 이벤트 목록(<모듈>.events.json)에서 approvalId · outcome 칸을 가진 주제와 같아야 한다 (approval-result.handler.test.ts).
// 기능 패키지의 결과(plugin.code_github.task_started · plugin.browser_tabs.run_done 등)는 plugin.*로 받는다:
// 패키지의 주제는 목록 파일이 정하고(manifest.emits) 코어의 이벤트 목록에 없다.
@Injectable()
export class ApprovalResultHandler extends BaseHandler {
  /** 결재한 동작의 결과를 담는 주제 */
  static readonly TOPICS: readonly string[] = [
    'platform.setting.changed',
    'account.setting.changed',
    'vault.setting.changed',
    'blog.setting.changed',
    'task.setting.changed',
    'blog.post.published',
    'blog.post.publish_failed',
    'blog.issue.published',
    'blog.issue.publish_failed',
    'task.external_tool.plugged',
    'task.external_tool.plug_failed',
    'plugin.*',
  ];

  constructor(private readonly approvals: ApprovalService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (!ApprovalResultInput.carriedBy(event.data)) return;
    await this.approvals.applyResult(
      new SystemActor(),
      event.spaceId,
      ApprovalResultInput.from(event.data),
    );
  }
}
