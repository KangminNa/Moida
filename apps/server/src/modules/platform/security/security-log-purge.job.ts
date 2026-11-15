import { Injectable } from '@nestjs/common';
import { SystemActor } from '../base/actor';
import { BaseJob } from '../base/base-job';
import { SecurityLogService } from './security-log.service';

// 하루에 한 번 보관 기간이 지난 보안 기록을 지운다. 두 번 돌아도 같다
@Injectable()
export class SecurityLogPurgeJob extends BaseJob {
  static readonly EVERY_MS = 86_400_000;
  readonly name = 'platform.security-log-purge';

  constructor(private readonly log: SecurityLogService) {
    super();
  }

  async run(): Promise<void> {
    await this.log.purge(new SystemActor(), new Date());
  }
}
