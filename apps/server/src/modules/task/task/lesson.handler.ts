import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { TaskService } from './task.service';

// 피드백에서 배우기 (2026-11-20): 관리자가 수정 요청을 남길 때마다 배울 때가 됐는지 본다 (TaskService.learn).
// 두 번 불려도 공간 · 날마다 일 하나다 (Lessons.requestId)
@Injectable()
export class LessonHandler extends BaseHandler {
  static readonly TOPICS: readonly string[] = ['task.approval.revision_requested'];

  constructor(private readonly tasks: TaskService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    await this.tasks.learn(new SystemActor(), event.spaceId);
  }
}
