import { Injectable } from '@nestjs/common';
import { BaseDueJob, SystemActor } from '../../platform';
import { TidyQuery } from './tidy.query';
import { TidyService } from './tidy.service';
import { TidySettings } from './tidy-settings';

// 세션 정리를 하루 한 번 몰아서 (2차 7단계, 정리 설정 cadence daily). 한 시간마다 차례가 된 공간을 찾아
// 지난 차례 뒤로 새 판이 쌓인 세션을 한 묶음 요청한다. 두 번 돌아도 같다 (TidyService.daily가 잠근 뒤 다시 본다).
// 마감 작업 (리팩토링 2단계): 가장 이른 다음 차례에 깬다. 정리 설정을 저장하면 깨운다 (TidySettingsRepository.save)
@Injectable()
export class TidyDailyJob extends BaseDueJob {
  readonly name = TidySettings.DAILY_JOB;

  constructor(
    private readonly query: TidyQuery,
    private readonly service: TidyService,
  ) {
    super();
  }

  async run(): Promise<Date | null> {
    const system = new SystemActor();
    for (const space of await this.query.dailySpaces(system))
      await this.service.daily(system, space);
    return this.query.nextDaily(system);
  }
}
