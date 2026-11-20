import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { ChatResultService } from './chat-result.service';

// 대화의 일이 바뀌면(작업 상태 · 결재 요청 · 검수) 결과 결재의 다음을 정한다 (2차 2단계). 대화의 일인지 · 가라앉았는지는 서비스가 본다.
// 결재 이벤트의 chatId가 있으면 그 대화를 본다 (작업에 묶이지 않은 앱 화면 공개 · 검수, 2026-11-20)
@Injectable()
export class ChatResultHandler extends BaseHandler {
  static readonly TOPICS: readonly string[] = [
    'task.task.changed',
    'task.approval.requested',
    'task.approval.inspected',
  ];

  constructor(private readonly results: ChatResultService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    const { taskId, chatId } = event.data;
    const chat = typeof chatId === 'string' ? chatId : null;
    if (typeof taskId !== 'string' && chat === null) return;
    await this.results.settle(
      new SystemActor(),
      event.spaceId,
      typeof taskId === 'string' ? taskId : null,
      chat,
    );
  }
}
