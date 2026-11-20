import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { Task } from '../task/task';
import { ScheduleService } from './schedule.service';

// 레시피의 일이 끝나면(task.task.changed의 완료) 그 뒤에 도는 레시피를 돌린다 (자동화 레시피의 계기 after, 2차 5단계).
// 어느 레시피의 일인지 · 뒤에 무엇이 도는지는 서비스가 본다. 같은 이벤트를 두 번 받아도 한 번만 돈다
@Injectable()
export class ScheduleFollowHandler extends BaseHandler {
  constructor(private readonly schedules: ScheduleService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    const taskId = String(event.data.taskId);
    // 자동화 건강 검사 (2026-11-20): 레시피의 일이 실패하면 잇달아 실패했는지 본다
    if (event.data.status === Task.FAILED)
      await this.schedules.checkHealth(new SystemActor(), event.spaceId, taskId);
    if (event.data.status !== Task.DONE) return;
    await this.schedules.follow(new SystemActor(), event.spaceId, taskId);
  }
}
