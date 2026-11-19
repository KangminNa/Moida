import { Injectable } from '@nestjs/common';
import { BaseDueJob, SystemActor } from '../../platform';
import { TaskQuery } from './task.query';
import { TaskService } from './task.service';

// 팀원 기다리기 (2026-11-19): 하위 작업을 기다리는 위 작업의 기한(wait_until)이 지나면 다 끝나지 않아도 깨운다.
// 마감 작업: 가장 이른 기한에 깬다. 기한은 작업이 바뀔 때(task.task.changed) 생기거나 사라지므로 그때 다시 잰다
@Injectable()
export class SubtaskWaitJob extends BaseDueJob {
  readonly name = 'task.subtask_waits';

  constructor(
    private readonly tasks: TaskService,
    private readonly query: TaskQuery,
  ) {
    super();
  }

  async run(now: Date): Promise<Date | null> {
    const system = new SystemActor();
    await this.tasks.wakeOverdue(system, await this.query.overdueWaits(system, now), now);
    return this.query.nextWaitEnd(system);
  }
}
