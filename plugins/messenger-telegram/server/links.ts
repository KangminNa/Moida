import {
  type Actor,
  Command,
  NotFound,
  Operation,
  Read,
  Rule,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { links, pairings } from './schema';
import { TelegramBot } from './telegram-bot';
import { DoneView, LinkListView, LinkView, PairingView } from './views';

// 관리자가 콘솔(운영 › 텔레그램)에서 하는 일: 이어 둔 계정 보기 · 연결 코드 받기 · 연결 끊기.

/** GET /api/p/messenger-telegram/links: 이어 둔 계정과 봇 설정이 갖춰졌는지 (관리자) */
export class ListLinks extends Read<Record<string, never>> {
  readonly name = 'listLinks';
  readonly allow = Operation.OWNER;

  constructor(private readonly ready: boolean) {
    super();
  }

  input(): Record<string, never> {
    return {};
  }

  async run(work: Work, actor: Actor): Promise<LinkListView> {
    const rows = await work.rows(links, { space_id: actor.requireSpace() }, { order: ['id desc'] });
    return new LinkListView(
      rows.map((r) => new LinkView(r)),
      this.ready,
    );
  }
}

/**
 * POST /api/p/messenger-telegram/pairings: 연결 코드 하나 (관리자). 코드는 이 답에만 보이고 sha256만 남는다.
 * 10분 안에 봇에게 보낸 계정이 이 공간에 이어진다. 지난 코드는 이때 지운다
 */
export class CreatePairing extends Command<Record<string, never>> {
  readonly name = 'createPairing';
  readonly allow = Operation.OWNER;

  input(): Record<string, never> {
    return {};
  }

  async run(work: Work, actor: Actor): Promise<PairingView> {
    const space = actor.requireSpace();
    const now = new Date();
    await work.deleteRows(pairings, { space_id: space, expires_at: Rule.atMost(now) });
    const code = TelegramBot.newCode();
    const expiresAt = new Date(now.getTime() + TelegramBot.CODE_MINUTES * 60_000);
    await work.insertRows(pairings, {
      space_id: space,
      code_hash: TelegramBot.codeHash(code),
      expires_at: expiresAt,
    });
    return new PairingView(code, expiresAt);
  }
}

/** POST /api/p/messenger-telegram/links/:id/unlink: 연결 끊기 (관리자). 그 계정의 말은 더 받지 않고 답도 보내지 않는다 */
export class Unlink extends Command<{ id: string }> {
  readonly name = 'unlink';
  readonly allow = Operation.OWNER;

  input(raw: unknown): { id: string } {
    return this.fields(raw, (f) => ({ id: f.uuid('id') }));
  }

  async run(work: Work, actor: Actor, input: { id: string }): Promise<DoneView> {
    const removed = await work.deleteRows(links, { id: input.id, space_id: actor.requireSpace() });
    if (removed === 0) throw new NotFound('없는 연결이에요');
    return new DoneView(true);
  }
}
