import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { ChatInspectService } from './chat-inspect.service';

// 작업이 바뀌면(task.task.changed) 끝난 검수 작업의 결정을 그 결재에 적는다 (2026-11-20). 검수 작업인지는 서비스가 본다
@Injectable()
export class ChatInspectHandler extends BaseHandler {
  constructor(private readonly inspections: ChatInspectService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    const taskId = event.data.taskId;
    if (typeof taskId !== 'string') return;
    await this.inspections.apply(new SystemActor(), event.spaceId, taskId);
  }
}
