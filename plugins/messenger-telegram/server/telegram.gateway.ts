import { BaseGateway, ExternalFailure } from '../../../apps/server/src/plugin-api';

// 텔레그램 Bot API (https://core.telegram.org/bots/api). 보내기 · 웹훅 걸기만.
// 토큰은 주소에 들어가므로 오류 글에 주소를 넣지 않는다 (텔레그램이 준 설명만).
export class TelegramGateway extends BaseGateway {
  /** 한 통의 글 한도 (Bot API sendMessage) */
  static readonly TEXT_MAX = 4096;
  protected readonly name = '텔레그램';

  constructor(
    private readonly token: string,
    private readonly apiUrl: string,
  ) {
    super();
  }

  /** 1:1 대화에 글 한 통. 링크 미리보기는 끈다 (콘솔 주소의 미리보기가 로그인 화면이라) */
  async send(chatId: number, text: string): Promise<void> {
    await this.method('sendMessage', {
      chat_id: chatId,
      text: text.slice(0, TelegramGateway.TEXT_MAX),
      link_preview_options: { is_disabled: true },
    });
  }

  /** 이 봇의 메시지를 받을 주소. 밀린 메시지는 버리고 1:1 메시지만 받는다 */
  async setWebhook(url: string): Promise<void> {
    await this.method('setWebhook', {
      url,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    });
  }

  private async method(name: string, body: object): Promise<void> {
    const answer = await this.call(async (signal) => {
      const res = await fetch(`${this.apiUrl.replace(/\/+$/, '')}/bot${this.token}/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
      return { status: res.status, json };
    });
    if (!answer.json.ok)
      throw new ExternalFailure(
        `텔레그램 ${name}이 거절했어요: ${answer.status} ${String(answer.json.description ?? '').slice(0, 200)}`,
      );
  }
}
