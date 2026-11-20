import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { Task } from '../task/task';
import { VerdictService } from './verdict.service';

// 판정 남기기 (2026-11-20): 작업이 바뀌면(task.task.changed) 끝난 작업마다 검토 · 검수 작업이면 판정을 쌓는다 (VerdictService.record). 두 번 불려도 같다
@Injectable()
export class VerdictHandler extends BaseHandler {
  constructor(private readonly verdicts: VerdictService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    const { taskId, status } = event.data;
    if (typeof taskId !== 'string' || status !== Task.DONE) return;
    await this.verdicts.record(new SystemActor(), event.spaceId, taskId);
  }
}
