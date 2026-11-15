import { Injectable } from '@nestjs/common';
import { BaseDueJob, SystemActor } from '../../platform';
import { Schedule } from './schedule';
import { ScheduleQuery } from './schedule.query';
import { ScheduleService } from './schedule.service';

// 때가 된 스케줄을 돌린다. 두 번 돌아도(일꾼이 둘이어도) 같은 시각의 작업은 하나다.
// 마감 작업 (리팩토링 2단계): 켜진 스케줄의 가장 이른 다음 시각에 깬다. 스케줄을 만들거나 고치면 저장이 깨운다 (ScheduleRepository.dueWake)
@Injectable()
export class ScheduleJob extends BaseDueJob {
  readonly name = Schedule.DUE_JOB;

  constructor(
    private readonly schedules: ScheduleService,
    private readonly query: ScheduleQuery,
  ) {
    super();
  }

  async run(): Promise<Date | null> {
    const system = new SystemActor();
    await this.schedules.runDue(system);
    return this.query.nextRun(system);
  }
}
