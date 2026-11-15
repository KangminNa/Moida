import { Injectable } from '@nestjs/common';
import { BaseDueJob, SystemActor } from '../../platform';
import { Task } from '../task/task';
import { TaskQuery } from '../task/task.query';
import { ChatRoute } from './chat-route.policy';
import { ChatRouteService } from './chat-route.service';

// 1분 넘게 아무도 빌려 가지 않은 배정 일을 서버의 질문으로 바꾼다 (2차 1-5). 러너가 하나도 없어도 관리자가 기다리지 않게.
// 마감 작업 (리팩토링 2단계): 기다리는 배정 일 가운데 가장 오래된 것이 1분이 되는 때에 깬다. 작업이 생기거나 바뀌면(task.task.changed) 다시 잰다
@Injectable()
export class ChatRouteJob extends BaseDueJob {
  readonly name = 'task.chat-routes';

  constructor(
    private readonly routes: ChatRouteService,
    private readonly tasks: TaskQuery,
  ) {
    super();
  }

  async run(): Promise<Date | null> {
    const system = new SystemActor();
    await this.routes.overdue(system);
    const oldest = await this.tasks.oldestQueued(system, Task.ROUTE);
    return oldest === null ? null : new Date(oldest.getTime() + ChatRoute.WAIT_MS);
  }
}
