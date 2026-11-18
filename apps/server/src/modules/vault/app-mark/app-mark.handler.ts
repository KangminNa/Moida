import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { AppEventInput } from './app-mark.input';
import { AppMarkService } from './app-mark.service';

// blog의 앱 이벤트(blog.app.changed)로 앱 공개 여부 사본을 맞춘다 (스토어 1-2). 두 번 와도, 순서가 바뀌어도 결과가 같다.
@Injectable()
export class AppMarkHandler extends BaseHandler {
  static readonly TOPIC = 'blog.app.changed';

  constructor(private readonly marks: AppMarkService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    await this.marks.keep(new SystemActor(), event.spaceId, AppEventInput.from(event));
  }
}
