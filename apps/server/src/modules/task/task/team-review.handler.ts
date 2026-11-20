import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { Task } from './task';
import { TaskService } from './task.service';

// 주간 팀 점검 (2026-11-20): 일이 끝날 때마다(task.task.changed done) 점검할 때가 됐는지 본다 (TaskService.reviewTeam).
// 두 번 불려도 공간 · 날마다 일 하나다 (TeamReview.requestId)
@Injectable()
export class TeamReviewHandler extends BaseHandler {
  constructor(private readonly tasks: TaskService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (event.data.status !== Task.DONE) return;
    await this.tasks.reviewTeam(new SystemActor(), event.spaceId);
  }
}
