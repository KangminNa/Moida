import { Actor, Forbidden, RuleViolation } from '../../platform';
import type { ChatDeliver } from '../task.tables';
import { ChatResult } from './chat-result.policy';
import { TurnBrief } from './turn-brief.policy';

/** payload.chat의 칸 가운데 받을 것이 보는 것 */
type TurnChat = {
  chatId?: unknown;
  reply?: unknown;
  review?: unknown;
  deliver?: unknown;
  deliverNote?: unknown;
};

// 회차의 받을 것 (O-3, docs/서브나.md 14장, 2026-11-18): 대표가 첫 실행에서 정하고(MCP set_deliver)
// 서버가 회차가 가라앉을 때 결과 카드에서 본다 (ChatResult.missing). 맨 위 회차 작업의 payload.chat.deliver에 적는다 (표를 더하지 않는다).
// 다시 맡긴 회차(검사 · 검토 반영 · 승인 뒤 이어서)는 앞 회차의 값을 물려받는다 (Chat.fix).
// 관리자 · 스케줄 레시피가 대화에 정한 값(chats.deliver)이 있으면 그 값만 받는다 (원칙 3: 사람이 정한 것이 우선)
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. Task · Chat · ChatResultService · ChatQuery가 함께 쓴다
export class TurnDeliver {
  /** 받을 것의 까닭 (화면의 칩에 보인다) */
  static readonly NOTE_MAX = 200;
  /** 화면 이름 (서버가 여는 회차의 한 줄에 쓴다, 웹은 _task/labels.ts) */
  private static readonly LABELS: Readonly<Record<ChatDeliver, string>> = {
    answer: '답',
    file: '파일',
    html: '페이지',
    app_code: '앱 코드',
    blog: '글',
    browser: '브라우저',
    code: '코드',
    setting: '설정 · 자동화',
  };

  /**
   * 받을 것을 적은 새 payload. 대표의 회차가 아니면(덧붙인 말의 답 · 검토 · 대화 밖) Forbidden,
   * 관리자가 정한 값(fixed)과 다르거나 이번 회차에 이미 다른 값을 정했으면 RuleViolation. 같은 값이면 까닭만 새로 (주면)
   */
  static declare(
    payload: Readonly<Record<string, unknown>>,
    deliver: string,
    note: string | null,
    fixed: string | null,
  ): Record<string, unknown> {
    const chat = (payload.chat ?? null) as TurnChat | null;
    if (typeof chat?.chatId !== 'string' || chat.reply === true || chat.review === true)
      throw new Forbidden(Actor.AGENT, '대화 회차를 맡은 대표만 정해요');
    const value = ChatResult.deliverOf(deliver) as ChatDeliver;
    if (fixed !== null && fixed !== value)
      throw new RuleViolation(`이 대화의 받을 것은 관리자가 정했어요 (${fixed})`);
    const before = TurnDeliver.of(payload);
    if (before !== null && before !== value)
      throw new RuleViolation(`이번 회차의 받을 것은 이미 정했어요 (${before})`);
    // 까닭을 주지 않으면 앞의 까닭을 둔다
    const given = note?.trim().slice(0, TurnDeliver.NOTE_MAX) || null;
    const text = given ?? TurnDeliver.noteOf(payload);
    return { ...payload, chat: { ...chat, deliver: value, deliverNote: text } };
  }

  /** 회차 작업의 payload에 적힌 받을 것. 없으면 null */
  static of(payload: unknown): string | null {
    const chat = ((payload ?? {}) as { chat?: TurnChat }).chat;
    return typeof chat?.deliver === 'string' ? chat.deliver : null;
  }

  /** 받을 것의 까닭. 없으면 null */
  static noteOf(payload: unknown): string | null {
    const chat = ((payload ?? {}) as { chat?: TurnChat }).chat;
    return typeof chat?.deliverNote === 'string' ? chat.deliverNote : null;
  }

  /** 받을 것의 화면 이름 */
  static label(deliver: string): string {
    return TurnDeliver.LABELS[deliver as ChatDeliver] ?? deliver;
  }

  /**
   * 검사할 받을 것: 이번 회차에 정한 값, 없으면 대화의 값(관리자 · 레시피). 둘 다 없으면 null (짧은 답, 검사 없음).
   * 목표 확인 질문을 한 회차는 묻는 것이 결과라 검사하지 않는다 (TurnBrief)
   */
  static effective(turnPayload: unknown, chatDeliver: string | null): string | null {
    if (TurnBrief.asked(turnPayload)) return null;
    return TurnDeliver.of(turnPayload) ?? chatDeliver;
  }
}
