import { DomainEvent, type Work } from '../../../apps/server/src/plugin-api';
import { TelegramGateway } from './telegram.gateway';

// 텔레그램으로 돌려보낼 글. 쓰기 동작 안에서는 보내지 않고 이벤트(plugin.telegram.send)로 남긴다:
// 트랜잭션이 커밋된 뒤 일꾼의 SendHandler가 보낸다 (트랜잭션 안에서 바깥을 기다리지 않는다).
export class Replies {
  static readonly SEND = 'plugin.telegram.send';

  constructor(
    /** 이 Cairn의 바깥 주소 (설정 siteUrl, 끝의 /는 뺀다) */
    private readonly site: string,
  ) {}

  /** 보낼 글 한 통을 남긴다 */
  send(work: Work, spaceId: string, chatId: number, text: string): void {
    work.record(
      new DomainEvent(Replies.SEND, 1, spaceId, {
        chatId,
        text: text.slice(0, TelegramGateway.TEXT_MAX),
      }),
    );
  }

  chatUrl(chatId: string): string {
    return `${this.site}/admin/chats/${chatId}`;
  }

  /** 회차의 결과를 정리한 HTML (대화 결과 HTML, 2026-11-23) */
  reportUrl(chatId: string): string {
    return `${this.chatUrl(chatId)}/report`;
  }

  help(): string {
    return [
      '여기에 쓰면 대표에게 맡겨요.',
      '/new 새 대화 (/new 뒤에 바로 말을 써도 돼요)',
      `승인은 콘솔에서 해요: ${this.site}/admin`,
    ].join('\n');
  }
}
