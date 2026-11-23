import { BaseHandler, type DomainEvent } from '../../../apps/server/src/plugin-api';
import { Replies } from './replies';
import type { TelegramGateway } from './telegram.gateway';

// plugin.telegram.send를 받아 텔레그램으로 보낸다 (일꾼, 트랜잭션 밖). 실패하면 일꾼이 다시 시도한다:
// 텔레그램이 받았는데 답을 놓치면 같은 글이 두 번 갈 수 있다 (빠지는 것보다 낫다).
export class SendHandler extends BaseHandler {
  constructor(private readonly telegram: TelegramGateway | null) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (event.name !== Replies.SEND || !this.telegram) return;
    const { chatId, text } = event.data as { chatId?: unknown; text?: unknown };
    if (!Number.isSafeInteger(chatId) || typeof text !== 'string' || !text) return;
    await this.telegram.send(chatId as number, text);
  }
}
