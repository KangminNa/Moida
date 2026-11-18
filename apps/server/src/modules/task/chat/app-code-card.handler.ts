import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { AppCodeAddedInput } from './chat.input';
import { ChatResultService } from './chat-result.service';

// 앱 코드에 새 버전이 쌓이면(blog.app_code.added, 스토어 1-6b) 대화의 만들기 일이 낸 확인 대기 버전을 그 대화의
// 결과 카드에 공개 승인으로 싣는다. 대화의 일인지 · 실을 버전인지는 서비스가 본다. 두 번 받아도 결재는 하나
@Injectable()
export class AppCodeCardHandler extends BaseHandler {
  static readonly TOPIC = 'blog.app_code.added';

  constructor(private readonly results: ChatResultService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    await this.results.offerAppCode(
      new SystemActor(),
      event.spaceId,
      AppCodeAddedInput.from(event.data),
    );
  }
}
