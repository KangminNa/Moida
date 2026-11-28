import { ActionResult, type Actor, BaseAction } from '../../../apps/server/src/plugin-api';
import type { TelegramGateway } from './telegram.gateway';
import { TelegramBot } from './telegram-bot';

// 웹훅 연결: 텔레그램이 이 봇의 메시지를 이 Moida의 바깥 주소로 보내게 한다 (설정을 바꾼 뒤 한 번 누른다).
// 주소의 열쇠는 봇 토큰에서 만든다: 토큰을 바꾸면 다시 누른다.
export class ConnectAction extends BaseAction {
  readonly label = '웹훅 연결';

  constructor(
    private readonly telegram: TelegramGateway | null,
    private readonly token: string,
    private readonly site: string,
  ) {
    super();
  }

  async run(actor: Actor): Promise<ActionResult> {
    actor.assertOwner();
    if (!this.telegram || !this.site)
      return ActionResult.failed('봇 토큰과 바깥 주소를 먼저 채워요');
    if (!/^https:\/\//.test(this.site))
      return ActionResult.failed(
        '바깥 주소는 https://로 시작해야 해요 (텔레그램이 https로만 보내요)',
      );
    await this.telegram.setWebhook(
      `${this.site}${TelegramBot.HOOK_PATH}${TelegramBot.hookKey(this.token)}`,
    );
    return ActionResult.done('연결했어요', ['콘솔 › 텔레그램에서 연결 코드를 받아 봇에게 보내요']);
  }
}
