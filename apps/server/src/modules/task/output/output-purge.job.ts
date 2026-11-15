import { Injectable } from '@nestjs/common';
import { BaseDueJob, SystemActor } from '../../platform';
import { Output } from './output';
import { OutputQuery } from './output.query';
import { OutputService } from './output.service';

// 휴지통 기간(30일)이 지난 결과물을 지운다. 파일은 아무도 쓰지 않게 되면 platform의 BlobSweepJob이 지운다.
// 마감 작업 (리팩토링 2단계): 휴지통의 가장 이른 지울 때에 깬다. 휴지통으로 보내면 저장이 깨운다 (OutputRepository.dueWake)
@Injectable()
export class OutputPurgeJob extends BaseDueJob {
  readonly name = Output.PURGE_JOB;

  constructor(
    private readonly outputs: OutputService,
    private readonly query: OutputQuery,
  ) {
    super();
  }

  async run(): Promise<Date | null> {
    const system = new SystemActor();
    await this.outputs.purgeExpired(system, new Date());
    return this.query.nextPurge(system);
  }
}
