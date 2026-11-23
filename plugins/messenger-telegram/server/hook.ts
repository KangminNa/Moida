import {
  type Actor,
  Command,
  NotFound,
  Operation,
  Rule,
  type Work,
} from '../../../apps/server/src/plugin-api';
import type { Replies } from './replies';
import { links, pairings, threads } from './schema';
import type { LinkRow } from './tables';
import { TelegramBot, type TelegramMessage } from './telegram-bot';
import { DoneView } from './views';

type HookInput = { key: string; message: TelegramMessage | null };

/**
 * POST /api/p/messenger-telegram/hook/:key: 텔레그램이 보낸 메시지 (웹훅, 누구나 부를 수 있는 주소라 열쇠로 지킨다).
 *   열쇠(봇 토큰에서 만든 값)가 틀리면 404
 *   연결 코드면 그 계정을 코드를 받은 공간에 잇는다 (코드는 한 번만, 10분)
 *   이어 둔 계정의 말이면 관리자의 대화로 (work.sendChat: 지금 대화에 이어서, /new면 새 대화). 같은 업데이트는 한 번만
 *   그 밖(모르는 계정 · 그룹 · 봇 · 글이 아닌 것)은 답하지 않고 넘긴다: 실패로 답하면 텔레그램이 다시 보낸다
 * 승인은 이 길로 하지 못한다 (원칙 7): 대화에 말만 넣고, 승인 링크는 콘솔로 보낸다.
 */
export class Receive extends Command<HookInput> {
  readonly name = 'receive';
  readonly allow = Operation.ANYONE;

  constructor(
    private readonly token: string,
    private readonly replies: Replies,
  ) {
    super();
  }

  input(raw: unknown): HookInput {
    return { key: this.fields(raw, (f) => f.text('key', 80)), message: TelegramBot.read(raw) };
  }

  async run(work: Work, _actor: Actor, { key, message }: HookInput): Promise<DoneView> {
    if (!TelegramBot.keyMatches(this.token, key)) throw new NotFound('없는 경로예요');
    if (!message) return new DoneView(false);
    const link = await work.row(links, { user_id: message.userId });
    const code = TelegramBot.codeIn(message.text);
    if (code && (await this.pair(work, message, code, link))) return new DoneView(true);
    // 모르는 계정: 답하지 않는다 (봇이 있다는 것 말고는 알려 주지 않게)
    if (!link) return new DoneView(false);
    if (TelegramBot.isHelp(message.text)) {
      this.replies.send(work, link.space_id, link.chat_id, this.replies.help());
      return new DoneView(true);
    }
    const fresh = TelegramBot.newChat(message.text);
    if (fresh && !fresh.rest) {
      await work.updateRows(links, { current_chat: null, updated_at: Rule.now }, { id: link.id });
      this.replies.send(work, link.space_id, link.chat_id, '다음 말부터 새 대화예요');
      return new DoneView(true);
    }
    await this.talk(work, link, message, fresh ? fresh.rest : message.text, fresh !== null);
    return new DoneView(true);
  }

  /** 연결 코드가 맞으면 잇고 true. 없거나 지난 코드면 false (이어 둔 계정이면 보통 말로 넘어간다) */
  private async pair(
    work: Work,
    message: TelegramMessage,
    code: string,
    link: LinkRow | null,
  ): Promise<boolean> {
    const pairing = await work.row(pairings, {
      code_hash: TelegramBot.codeHash(code),
      expires_at: Rule.after(new Date()),
    });
    if (!pairing) return false;
    await work.deleteRows(pairings, { id: pairing.id });
    const fields = { space_id: pairing.space_id, chat_id: message.chatId, name: message.name };
    if (link)
      await work.updateRows(
        links,
        { ...fields, current_chat: null, updated_at: Rule.now },
        { id: link.id },
      );
    else await work.insertRows(links, { ...fields, user_id: message.userId });
    this.replies.send(
      work,
      pairing.space_id,
      message.chatId,
      `연결했어요.\n${this.replies.help()}`,
    );
    return true;
  }

  /** 관리자의 대화에 말한다. 대화가 바뀌면 지금 대화로 기억하고, 답을 돌려보낼 곳(threads)을 적는다 */
  private async talk(
    work: Work,
    link: LinkRow,
    message: TelegramMessage,
    text: string,
    fresh: boolean,
  ): Promise<void> {
    // 같은 업데이트는 한 번만 (봇마다 번호가 따로라 봇 토큰의 열쇠를 함께)
    const requestId = `telegram:${TelegramBot.hookKey(this.token).slice(0, 12)}:${message.updateId}`;
    const sent = await work.sendChat(
      link.space_id,
      fresh ? null : link.current_chat,
      requestId,
      text,
    );
    if (sent.chatId !== link.current_chat)
      await work.updateRows(
        links,
        { current_chat: sent.chatId, updated_at: Rule.now },
        { id: link.id },
      );
    if (!(await work.exists(threads, { chat_id: sent.chatId })))
      await work.insertRows(threads, { chat_id: sent.chatId, link_id: link.id });
    const ack = sent.appended ? '덧붙였어요 · 일하는 중' : `맡겼어요 · ${sent.turn}번째`;
    this.replies.send(work, link.space_id, link.chat_id, ack);
  }
}
