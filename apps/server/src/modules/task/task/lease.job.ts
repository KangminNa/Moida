import { Injectable } from '@nestjs/common';
import { BaseDueJob, SystemActor } from '../../platform';
import { JobService } from './job.service';
import { TaskQuery } from './task.query';

// 임대가 끝난 작업을 되돌린다. 러너가 하나도 없어도 세 번 끝난 작업이 실패로 보이게 일꾼이 돈다.
// 마감 작업 (리팩토링 2단계): 진행 중 작업의 임대가 가장 먼저 끝나는 때에 깬다. 빌리면 상태가 바뀌어(task.task.changed) 다시 잰다.
// 진행 보고로 임대가 늘면 이른 시각에 한 번 깨어 늘어난 때로 다시 잡는다
@Injectable()
export class LeaseJob extends BaseDueJob {
  readonly name = 'task.leases';

  constructor(
    private readonly tasks: JobService,
    private readonly query: TaskQuery,
  ) {
    super();
  }

  async run(): Promise<Date | null> {
    const system = new SystemActor();
    await this.tasks.reclaim(system);
    return this.query.nextLeaseEnd(system);
  }
}
