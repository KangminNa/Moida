import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { Task } from '../task/task';
import { ChatUpdateService } from './chat-update.service';

// 작업이 끝나면(task.task.changed의 완료 · 실패) 대화의 소식을 남긴다. 대화의 일인지 · 무슨 소식인지는 서비스가 본다.
// 하위 작업을 기다리기 시작하면(waiting) 나눠 맡긴 계획을 판단 소식으로 (D3)
@Injectable()
export class ChatUpdateHandler extends BaseHandler {
  private static readonly SETTLED: readonly string[] = [Task.DONE, Task.FAILED];

  constructor(private readonly updates: ChatUpdateService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (event.data.status === Task.WAITING)
      return this.updates.notePlan(new SystemActor(), String(event.data.taskId));
    if (!ChatUpdateHandler.SETTLED.includes(String(event.data.status))) return;
    await this.updates.noteSettled(new SystemActor(), String(event.data.taskId));
  }
}
