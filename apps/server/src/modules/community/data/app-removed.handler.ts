import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { AppDataService } from './app-data.service';

// 앱을 지우면 (blog.app.changed, deleted) 그 앱이 선언한 표와 앱 스키마를 치운다 (2026-11-27, 사용자 "삭제를 누르면 데이터도
// 내보내지고 삭제할 수 있도록 해"). 줄이 남은 앱은 관리자가 내보내기를 받고 함께 지우기(withData)를 골랐을 때만 지워진다.
// 회원이 있는 앱은 blog가 지우지 않으므로 여기 오지 않는다. 두 번 받아도 같다 (없으면 그대로)
@Injectable()
export class AppRemovedHandler extends BaseHandler {
  static readonly TOPIC = 'blog.app.changed';

  constructor(private readonly data: AppDataService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    const { appId, deleted } = event.data as { appId?: unknown; deleted?: unknown };
    if (deleted !== true || typeof appId !== 'string') return;
    await this.data.dropApp(new SystemActor(), appId);
  }
}
