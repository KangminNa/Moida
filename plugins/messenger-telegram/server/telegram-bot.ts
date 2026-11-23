import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/** 텔레그램이 보낸 1:1 메시지 하나에서 쓰는 칸 */
export interface TelegramMessage {
  readonly updateId: number;
  readonly userId: number;
  readonly chatId: number;
  readonly name: string;
  readonly text: string;
}

// 봇의 규칙: 웹훅 주소의 열쇠, 연결 코드, 받은 메시지 읽기, 명령 가르기.
// 웹훅 열쇠는 봇 토큰에서 만든다 (저장하지 않는다): 토큰을 모르면 주소를 알 수 없고, 토큰을 바꾸면 주소도 바뀐다.
export class TelegramBot {
  /** 연결 코드의 글자: 헷갈리는 0 · O · 1 · I는 뺀다 */
  private static readonly ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  static readonly CODE = /^[A-HJ-NP-Z2-9]{8}$/;
  /** 연결 코드가 유효한 시간 */
  static readonly CODE_MINUTES = 10;
  static readonly HOOK_PATH = '/api/p/messenger-telegram/hook/';

  /** 웹훅 주소의 열쇠 (봇 토큰의 sha256에서 40자) */
  static hookKey(token: string): string {
    return createHash('sha256').update(`cairn-telegram-hook:${token}`).digest('hex').slice(0, 40);
  }

  /** 받은 열쇠가 맞는가 (시간이 같게 비교) */
  static keyMatches(token: string, key: string): boolean {
    const want = Buffer.from(TelegramBot.hookKey(token));
    const got = Buffer.from(key);
    return token !== '' && want.length === got.length && timingSafeEqual(want, got);
  }

  static newCode(): string {
    let code = '';
    for (let i = 0; i < 8; i++)
      code += TelegramBot.ALPHABET[randomInt(TelegramBot.ALPHABET.length)];
    return code;
  }

  static codeHash(code: string): string {
    return createHash('sha256').update(code.toUpperCase()).digest('hex');
  }

  /**
   * 받은 업데이트에서 사람이 봇에게 1:1로 보낸 글만. 그 밖(그룹 · 채널 · 봇 · 사진만 · 고친 글)은 null:
   * 웹훅은 실패하면 텔레그램이 다시 보내므로 모르는 모양도 오류 없이 넘긴다
   */
  static read(raw: unknown): TelegramMessage | null {
    const body = (raw ?? {}) as {
      update_id?: unknown;
      message?: {
        text?: unknown;
        from?: { id?: unknown; is_bot?: unknown; first_name?: unknown; username?: unknown };
        chat?: { id?: unknown; type?: unknown };
      };
    };
    const message = body.message;
    const from = message?.from;
    const chat = message?.chat;
    if (
      !Number.isSafeInteger(body.update_id) ||
      typeof message?.text !== 'string' ||
      !Number.isSafeInteger(from?.id) ||
      from?.is_bot === true ||
      chat?.type !== 'private' ||
      !Number.isSafeInteger(chat?.id)
    )
      return null;
    const text = message.text.trim();
    if (!text) return null;
    const name = String(from?.first_name ?? from?.username ?? '텔레그램')
      .trim()
      .slice(0, 100);
    return {
      updateId: body.update_id as number,
      userId: from?.id as number,
      chatId: chat?.id as number,
      name: name || '텔레그램',
      text: text.slice(0, 4000),
    };
  }

  /** 연결 코드를 보낸 것이면 그 코드: "ABCD2345" 또는 "/start ABCD2345" (봇 링크로 들어온 경우) */
  static codeIn(text: string): string | null {
    const word = text
      .replace(/^\/start(@\w+)?\s*/i, '')
      .trim()
      .toUpperCase();
    return TelegramBot.CODE.test(word) ? word : null;
  }

  /** /new [말]: 새 대화. 말이 있으면 그 말로 연다. /new가 아니면 null */
  static newChat(text: string): { rest: string } | null {
    const m = /^\/new(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
    return m ? { rest: (m[1] ?? '').trim() } : null;
  }

  /** 도움말 명령 (/start · /help) */
  static isHelp(text: string): boolean {
    return /^\/(start|help)(@\w+)?$/i.test(text);
  }
}
