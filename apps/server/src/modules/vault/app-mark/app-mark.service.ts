import { Injectable } from '@nestjs/common';
import { Actor, BaseService } from '../../platform';
import { AppMark } from './app-mark';
import type { AppEventInput } from './app-mark.input';
import { AppMarkRepository } from './app-mark.repository';

// 앱 공개 여부 사본 쓰기 (스토어 1-2). blog 이벤트를 받는 일꾼만 부른다.
@Injectable()
export class AppMarkService extends BaseService {
  async keep(actor: Actor, spaceId: string, event: AppEventInput): Promise<void> {
    actor.assertCan(Actor.TIDY);
    await this.transaction(async (tx) => {
      const marks = new AppMarkRepository(tx);
      const now = new Date();
      const found = await marks.lock(event.appId);
      found?.receive(event, now);
      await marks.save(found ?? AppMark.open(spaceId, event, now));
    });
  }
}
