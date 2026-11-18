import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { Task } from '../task/task';
import { ChatService } from './chat.service';

// 승인 뒤 이어서 (O-2): 끝난(done) 작업이 대표가 continue로 올린 설정 바꾸기를 승인받아 적용한 일이면 그 대화에 회차를 연다.
// 설정이 적용되면 그 결재를 기다리던 작업이 끝나므로(ApprovalResultHandler) 작업의 끝을 받는다: 적용 결과 이벤트를 받으면
// 작업이 아직 끝나기 전일 수 있다. 무엇을 이어 갈지는 서비스가 본다 (결재마다 한 번)
@Injectable()
export class ChatContinueHandler extends BaseHandler {
  constructor(private readonly chats: ChatService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    const taskId = event.data.taskId;
    if (typeof taskId !== 'string' || event.data.status !== Task.DONE) return;
    await this.chats.continueAfter(new SystemActor(), event.spaceId, taskId);
  }
}
