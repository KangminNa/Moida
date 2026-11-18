import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { AppCodeBuiltInput } from './app-code.input';
import { AppCodeService } from './app-code.service';

// 앱 코드를 고친 만들기 작업이 끝나며 알린 파일들을 받아 새 버전으로 쌓는다 (task를 부르지 않고 이벤트로 잇는다).
// 두 번 받아도 버전은 하나다 (실행마다 하나).
@Injectable()
export class AppCodeBuiltHandler extends BaseHandler {
  static readonly TOPIC = 'task.app_code.built';

  constructor(private readonly code: AppCodeService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    await this.code.built(new SystemActor(), event.spaceId, AppCodeBuiltInput.from(event.data));
  }
}
