import { type Actor, Command, Operation, type Work } from '../../../apps/server/src/plugin-api';
import type { Replies } from './replies';
import { links, threads } from './schema';
import type { LinkRow } from './tables';
import { DoneView } from './views';

// 대화에서 관리자에게 돌아가는 것을 텔레그램으로 (이벤트로 도는 동작, 서버 자신만).
// 텔레그램에서 연 · 이어 말한 대화(threads)만 보낸다. 콘솔에서만 쓴 대화는 보내지 않는다.

/** 텔레그램에서 쓴 대화의 계정 (연결을 끊었으면 null) */
async function linkOf(work: Work, spaceId: string, chatId: string): Promise<LinkRow | null> {
  const thread = await work.row(threads, { chat_id: chatId });
  return thread ? work.row(links, { id: thread.link_id, space_id: spaceId }) : null;
}

type SaidInput = { spaceId: string; chatId: string; title: string; kind: string; text: string };

/** task.chat.said: 회차의 최종 답 · 덧붙인 말의 답 · 실패 */
export class SendSaid extends Command<SaidInput> {
  readonly name = 'sendSaid';
  readonly allow = Operation.SYSTEM;

  constructor(private readonly replies: Replies) {
    super();
  }

  input(raw: unknown): SaidInput {
    return this.fields(raw, (f) => ({
      spaceId: f.uuid('spaceId'),
      chatId: f.uuid('chatId'),
      title: f.optionalText('title', 200) ?? '',
      kind: f.text('kind', 40),
      text: f.text('text', 4000),
    }));
  }

  async run(work: Work, _actor: Actor, input: SaidInput): Promise<DoneView> {
    const link = await linkOf(work, input.spaceId, input.chatId);
    if (!link) return new DoneView(false);
    this.replies.send(work, input.spaceId, link.chat_id, this.textOf(input));
    return new DoneView(true);
  }

  private textOf({ chatId, title, kind, text }: SaidInput): string {
    if (kind === 'failed')
      return `못 했어요 · ${title}\n${text}\n\n${this.replies.chatUrl(chatId)}`;
    if (kind !== 'final') return text;
    // 답은 앞부분만 싣고 전체는 정리한 HTML로 (한 통 4096자)
    const tail = `\n\nHTML로 보기: ${this.replies.reportUrl(chatId)}`;
    const head = `${title}\n\n`;
    const room = 4000 - head.length - tail.length;
    const body = text.length > room ? `${text.slice(0, room - 1)}…` : text;
    return `${head}${body}${tail}`;
  }
}

type AskedInput = { spaceId: string; action: string; targetId: string | null };

/** task.approval.requested의 결과 카드 (task.chat.result): 고를 것이 생겼다. 승인은 콘솔에서 */
export class SendCard extends Command<AskedInput> {
  readonly name = 'sendCard';
  readonly allow = Operation.SYSTEM;
  private static readonly CARD = 'task.chat.result';

  constructor(private readonly replies: Replies) {
    super();
  }

  input(raw: unknown): AskedInput {
    const target = (raw as { targetId?: unknown } | null)?.targetId;
    return this.fields(raw, (f) => ({
      spaceId: f.uuid('spaceId'),
      action: f.text('action', 100),
      targetId: typeof target === 'string' ? f.uuid('targetId') : null,
    }));
  }

  async run(work: Work, _actor: Actor, input: AskedInput): Promise<DoneView> {
    if (input.action !== SendCard.CARD || !input.targetId) return new DoneView(false);
    const link = await linkOf(work, input.spaceId, input.targetId);
    if (!link) return new DoneView(false);
    const text = `골라 주세요 · 결과가 나왔어요\n승인은 콘솔에서: ${this.replies.chatUrl(input.targetId)}`;
    this.replies.send(work, input.spaceId, link.chat_id, text);
    return new DoneView(true);
  }
}
