import { RuleViolation, ValueList } from '../../platform';
import { Task } from '../task/task';
import { CHAT_DELIVER, type ChatDeliver, type TaskRow } from '../task.tables';
import type { ChatReviewVerdict } from './chat.view';
import type { ChatTurnRow } from './chat-history.policy';
import { ChatReview } from './chat-review.policy';

/** 지금 회차의 맨 위 작업과 그 회차의 검토 작업 (ChatRepository.turnState. 없으면 칸이 비어 있다) */
export type ChatTurnStateRow = {
  status: TaskRow['status'] | null;
  instruction: TaskRow['instruction'] | null;
  result: TaskRow['result'] | null;
  review_status: TaskRow['status'] | null;
  review_result: TaskRow['result'] | null;
};

/** 가라앉은 회차의 모습 (ChatResultService가 모아 ChatResult.next에 넘긴다) */
export type ChatTurnSettled = {
  /** 지금 회차 맨 위 작업의 상태 (결재를 기다리다 가라앉았으면 waiting) */
  root: string | null;
  /** 아직 카드에 싣지 않은 결재 · 결과물 수 */
  items: number;
  /** 받을 것이 결과에 없는가 */
  missing: boolean;
  /** 이 회차가 이미 기다리는 카드에 실렸는가 (실린 뒤에 다시 판단해도 받을 것이 빠졌다고 보지 않는다) */
  carded: boolean;
  /** 이어진 다시 맡긴 회차 수 (모든 까닭 · 검토 반영만) */
  fixes: number;
  reviewFixes: number;
  /** 검토자 짝이 있는가, 이 회차를 검토했는가, 끝난 검토의 판정 */
  reviewer: boolean;
  reviewed: boolean;
  review: ChatReviewVerdict | null;
};

// 결과 결재의 판단 (2차 2단계 · 기획서 결정 2026-11-14). 상태 없음:
//   회차가 가라앉았을 때(도는 일이 없고 남은 일은 카드에 실릴 결재만 기다림) 다음에 할 일 하나,
//   받을 것(chats.deliver)의 검사, 카드에서 고른 항목.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. 결과 카드의 서비스 · 읽기가 함께 쓴다
export class ChatResult {
  /** 검사에 떨어져 팀에게 다시 맡기는 회차 수 (넘으면 떨어진 채로 카드에 보인다) */
  static readonly FIX_MAX = 2;
  /** 다음에 할 일 */
  static readonly NONE = 'none';
  static readonly FIX = 'fix';
  static readonly REVIEW = 'review';
  /** 검토가 고칠 것을 남겨 같은 상대에게 다시 맡김 (검증 고리 V) */
  static readonly REVIEW_FIX = 'review_fix';
  static readonly CARD = 'card';
  /** 다시 맡긴 회차의 까닭 (payload.chat.fixBy, 검토 반영만 적는다) */
  static readonly BY_REVIEW = 'review';
  /**
   * 받을 것마다 결과에 있어야 하는 것: 이름 끝이 그것인 결과물, 또는 그 동작 중 하나의 결재
   * (블로그는 글 하나의 발행이나 매거진 호의 발행, 2차 6단계)
   */
  private static readonly NEEDS: Readonly<
    Record<string, { output?: string; actions?: readonly string[] }>
  > = {
    html: { output: '.html' },
    blog: { actions: ['blog.post.publish', 'blog.issue.publish'] },
    browser: { actions: ['browser.site.publish'] },
    code: { actions: ['code.pr.merge'] },
  };

  /** 받을 것의 모양 검사 (DB의 값 목록). 비우면 null (대화 답) */
  static deliverOf(raw: string | null): ChatDeliver | null {
    if (raw === null) return null;
    if (!ValueList.has(CHAT_DELIVER, raw))
      throw new RuleViolation(`받을 것은 ${CHAT_DELIVER.join(' · ')} 중 하나예요`);
    return raw;
  }

  /** 받을 것이 결과에 없으면 그 받을 것, 있거나 정하지 않았으면 null */
  static missing(
    deliver: string | null,
    actions: readonly string[],
    outputs: readonly string[],
  ): string | null {
    const need = deliver === null ? undefined : ChatResult.NEEDS[deliver];
    if (!need) return null;
    const has = need.output
      ? outputs.some((name) => name.toLowerCase().endsWith(need.output as string))
      : (need.actions ?? []).some((action) => actions.includes(action));
    return has ? null : deliver;
  }

  /** 있어야 하는 것의 이름 (검사 실패 지시문에 싣는다) */
  static needOf(deliver: string): string {
    const need = ChatResult.NEEDS[deliver];
    return need?.output
      ? `${need.output} 결과물`
      : `${need?.actions?.join(' · ') ?? deliver} 승인 요청`;
  }

  /**
   * 가라앉은 회차의 다음 할 일. root: 지금 회차 맨 위 작업의 상태 (결재를 기다리다 가라앉았으면 waiting)
   *   회차가 끝났고 받을 것이 없으면(한도 안) → 다시 맡김. 실을 것이 없으면 → 없음.
   *   회차가 끝났거나 결재만 기다리고, 검토자가 있는데 아직 검토하지 않았으면 → 검토 (검증 고리 V: 결재를 기다리는 회차도).
   *   회차가 끝났고 검토가 고칠 것을 남겼으면(한도 안) → 검토 반영. 그 밖 → 카드.
   *   결재를 기다리는 회차는 다시 맡기지 않는다: 회차가 끝나지 않아 새 회차를 열 수 없다 (판정과 고칠 것은 카드에 실린다)
   * 이미 카드에 실린 회차는 다시 맡기지 않는다 (카드를 만든 뒤 다른 이벤트로 다시 판단하면 실을 것이 0이라 받을 것이 빠져 보인다)
   */
  static next({
    root,
    items,
    missing,
    carded,
    fixes,
    reviewFixes,
    reviewer,
    reviewed,
    review,
  }: ChatTurnSettled): string {
    const done = root === Task.DONE;
    const settled = done || root === Task.WAITING;
    if (done && missing && !carded && fixes < ChatResult.FIX_MAX) return ChatResult.FIX;
    if (items === 0) return ChatResult.NONE;
    if (settled && reviewer && !reviewed) return ChatResult.REVIEW;
    if (done && ChatReview.wantsFix(review) && reviewFixes < ChatReview.FIX_MAX)
      return ChatResult.REVIEW_FIX;
    return ChatResult.CARD;
  }

  /** 바로 앞까지 이어진 다시 맡긴 회차 수 (payload.chat.fix). by를 주면 그 까닭(fixBy)의 회차만 센다 */
  static fixesIn(
    previous: readonly Pick<ChatTurnRow, 'payload'>[],
    by: string | null = null,
  ): number {
    let count = 0;
    for (const turn of [...previous].reverse()) {
      const chat = (turn.payload as { chat?: { fix?: unknown; fixBy?: unknown } } | null)?.chat;
      if (chat?.fix !== true) break;
      if (by === null || chat.fixBy === by) count += 1;
    }
    return count;
  }

  /**
   * 카드에 실을 결과물 가운데 고친 것으로 바뀐 앞의 것 (검증 고리 V): 같은 이름이면 마지막 것만 싣는다.
   * 다시 맡긴 회차가 같은 파일을 고쳐 내면 앞의 것은 휴지통으로 (카드에서 고르지 않은 결과물과 같다)
   */
  static superseded<T extends { readonly id: string; readonly name: string }>(
    made: readonly T[],
  ): readonly T[] {
    const last = new Map<string, string>();
    for (const output of made) last.set(output.name.toLowerCase(), output.id);
    return made.filter((output) => last.get(output.name.toLowerCase()) !== output.id);
  }

  /** 카드에서 고른 항목. 비우면(null) 모두, 카드에 없는 id면 RuleViolation */
  static picked(picked: readonly string[] | null, ids: readonly string[]): ReadonlySet<string> {
    if (picked === null) return new Set(ids);
    const unknown = picked.filter((id) => !ids.includes(id));
    if (unknown.length > 0) throw new RuleViolation('카드에 없는 항목이에요');
    return new Set(picked);
  }

  /** 결과 글 (작업의 result.text) */
  static textOf(result: unknown): string {
    const text = (result as { text?: unknown } | null)?.text;
    return typeof text === 'string' ? text : '';
  }
}
