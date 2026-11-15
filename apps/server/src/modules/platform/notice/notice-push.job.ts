import { Injectable } from '@nestjs/common';
import { SystemActor } from '../base/actor';
import { BaseDueJob } from '../base/base-due-job';
import { NoticePushService } from './notice-push.service';
import { Notices } from './notices';

// 알림을 브라우저 푸시로 보낸다 (즉시는 바로, 묶음은 묶음 시각에, 조용한 시간에는 미룸).
// 마감 작업 (리팩토링 2단계): 알림이 남거나 알림 설정이 바뀌면 깨고, 남은 알림은 NoticePolicy.nextAt에 다시 본다.
// 두 번 돌아도(일꾼이 둘이어도) 같은 알림은 한 번만 다룬다 (잠그고 먼저 적는다).
@Injectable()
export class NoticePushJob extends BaseDueJob {
  readonly name = Notices.PUSH_JOB;

  constructor(private readonly push: NoticePushService) {
    super();
  }

  run(): Promise<Date | null> {
    return this.push.run(new SystemActor());
  }
}
