import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { AccountService } from './account.service';

// 메일의 해지 링크로 소식 메일을 끊었다 (메일 플러그인의 plugin.email.unsubscribed { accountId }, 2026-11-27):
// 계정의 수신 동의를 지운다. 내 정보의 "소식 메일 받기"가 메일 플러그인의 목록과 어긋나지 않게. 두 번 받아도 같다
@Injectable()
export class NewsUnsubscribedHandler extends BaseHandler {
  static readonly TOPIC = 'plugin.email.unsubscribed';

  constructor(private readonly accounts: AccountService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    const accountId = (event.data as { accountId?: unknown }).accountId;
    if (typeof accountId !== 'string' || !event.spaceId) return;
    await this.accounts.newsUnsubscribed(new SystemActor(), event.spaceId, accountId);
  }
}
