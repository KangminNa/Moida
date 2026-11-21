import type { Agent } from '../agent/agent';
import type { Approval } from '../approval/approval';
import { TaskRefs } from '../task/task-refs.policy';
import type { ChatReviewVerdict } from './chat.view';
import { ChatReview } from './chat-review.policy';

// 검수 (기획서 결정 2026-11-20, 원칙 7): 대표가 검수 승인을 켜 두면(agents.reviewer_approves) 대화의 일에서 올라온
// 앱 안의 공개(글 공개 · 앱 화면 공개)는 관리자의 결과 카드에 싣기 전에 대표의 검토자 짝(검수자)이 먼저 본다.
// 통과면 검수자가 관리자 대신 승인하고(실행은 관리자의 승인과 같다), 고칠 것이 있으면 올린 쪽에 돌려준다(FIX_MAX번까지).
// 그 밖(반려 권함 · 판정을 읽지 못함 · 다 고쳐도 남음 · 끝내지 못함)은 검수 의견을 붙여 관리자의 결과 카드로 넘긴다.
// 권한 · 팀 · 플러그인 · 설정 바꾸기 · 호 발행 같은 그 밖의 승인은 늘 관리자에게 간다. 상태 없음
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. 결과 결재와 검수 반영이 함께 쓴다
export class ChatInspect {
  /** 검수자가 승인할 수 있는 동작. 호 발행(blog.issue.publish)은 검수자가 호 안의 글을 읽는 길이 아직 없어 관리자에게 */
  static readonly ACTIONS: readonly string[] = ['blog.post.publish', 'blog.app_code.show'];
  /** 검수자가 같은 대상에 고쳐 달라고 하는 횟수 (넘으면 관리자에게) */
  static readonly FIX_MAX = 3;
  private static readonly POST = 'blog.post.publish';
  private static readonly LABELS: Readonly<Record<string, string>> = {
    'blog.post.publish': '글 공개',
    'blog.app_code.show': '앱 화면 공개',
  };

  /** 지금 검수할 결재인가: 검수할 동작이고, 아직 검수하지 않았고, 검수자가 올린 쪽 밖이다 (independent) */
  static due(approval: Approval, inspectors: readonly Agent[]): boolean {
    if (!ChatInspect.ACTIONS.includes(approval.action) || approval.inspected) return false;
    // 두 검수자(2026-11-20)면 둘 다 올린 쪽 밖이어야 한다: 하나라도 아니면 관리자에게
    return inspectors.every((inspector) => ChatInspect.independent(inspector, approval.agentId));
  }

  /**
   * 두 검수자의 판정을 하나로 (2026-11-20, ECC의 "둘 다 통과해야"): 하나라도 끝내지 못했으면 null, 둘 다 통과면 통과,
   * 하나라도 반려 권함이면 반려 권함, 하나라도 고칠 것이면 고칠 것(고칠 것을 합친다), 그 밖은 읽지 못함.
   * 점수(평균)는 낮은 쪽, 조건은 둘 다 싣는다(가장 낮은 점수는 ChatReview.lowOf). 검수자가 하나면 그 판정 그대로
   */
  static combine(reviews: readonly (ChatReviewVerdict | null)[]): ChatReviewVerdict | null {
    if (reviews.length === 1) return reviews[0] ?? null;
    if (reviews.length === 0 || reviews.some((r) => r === null)) return null;
    const all = reviews as readonly ChatReviewVerdict[];
    const has = (verdict: string) => all.some((r) => r.verdict === verdict);
    const verdict = all.every((r) => r.verdict === ChatReview.PASS)
      ? ChatReview.PASS
      : has(ChatReview.REJECT)
        ? ChatReview.REJECT
        : all.some((r) => ChatReview.wantsFix(r)) && !has(ChatReview.UNKNOWN)
          ? ChatReview.FIX
          : ChatReview.UNKNOWN;
    const scores = all.flatMap((r) => (r.score === null ? [] : [r.score]));
    return {
      verdict,
      summary: all.map((r, i) => `검수 ${i + 1}: ${r.summary || '-'}`).join(' / '),
      checklist: all.flatMap((r) => r.checklist),
      fixes: [...new Set(all.flatMap((r) => r.fixes))],
      skip: [...new Set(all.flatMap((r) => r.skip))],
      score: scores.length === all.length ? Math.min(...scores) : null,
    };
  }

  /**
   * 검수자가 올린 쪽 밖인가: 결재를 올린 에이전트가 아니다 (제 일을 제가 통과시키지 않게). 팀이 없어진 뒤(2026-11-21)
   * 보고 라인으로 가르지 않는다. AI 도구로도 가르지 않는다: 두 검수자는 서로 다른 도구라 둘 다 올린 쪽과 다를 수 없다
   */
  static independent(inspector: Agent, requesterId: string | null): boolean {
    return requesterId !== null && requesterId !== inspector.id;
  }

  /** 검수 작업에 실을 것: 무엇을 보는지(inspect, 앱이면 blog의 app_code_base가 읽는다)와 글이면 이 작업에서만의 읽기 허락 */
  static payloadOf(approval: Approval): Record<string, unknown> {
    const { id, action, targetKind, targetId } = approval;
    return {
      inspect: { approvalId: id, action, targetKind, targetId },
      ...ChatInspect.refsOf(approval).payload,
    };
  }

  /** 검수 작업이 보는 결재 (payload.inspect). 검수 작업이 아니면 null */
  static approvalOf(payload: unknown): string | null {
    const id = (payload as { inspect?: { approvalId?: unknown } } | null)?.inspect?.approvalId;
    return typeof id === 'string' ? id : null;
  }

  /**
   * 검수의 답 → 결정. review가 null이면 검수를 끝내지 못했다. fixes: 이 대상에 검수자가 이미 고쳐 달라고 한 수.
   * before: 같은 대상의 앞 검수 점수(평균). 고쳐 왔는데도 점수가 오르지 않았으면 한도 전이라도 관리자에게 (2026-11-20)
   */
  static outcome(
    review: ChatReviewVerdict | null,
    fixes: number,
    before: number | null = null,
  ): Parameters<Approval['inspect']>[0] {
    if (review?.verdict === ChatReview.PASS) return 'pass';
    if (
      ChatReview.wantsFix(review) &&
      fixes < ChatInspect.FIX_MAX &&
      !ChatInspect.stalled(review, before)
    )
      return 'fix';
    return 'hold';
  }

  /** 고쳐 왔는데 점수가 오르지 않았는가 (앞 점수나 이번 점수가 없으면 모른다) */
  static stalled(review: ChatReviewVerdict | null, before: number | null): boolean {
    return before !== null && review?.score != null && review.score <= before;
  }

  /** 결재에 남길 말: 통과의 까닭 · 고칠 것(올린 쪽이 받는다) · 관리자에게 넘기는 까닭 */
  static opinion(
    review: ChatReviewVerdict | null,
    outcome: Parameters<Approval['inspect']>[0],
    before: number | null = null,
  ): string {
    if (review === null) return '검수를 끝내지 못했어요';
    const summary = review.summary || '-';
    const score = review.score === null ? '' : ` (평균 ${review.score}점)`;
    if (outcome === 'pass') return `${summary}${score}`;
    if (outcome === 'fix')
      return [
        `검수 의견${score}: ${summary}`,
        '고칠 것:',
        ...review.fixes.map((f) => `- ${f}`),
      ].join('\n');
    if (ChatReview.wantsFix(review) && ChatInspect.stalled(review, before))
      return `고쳐도 점수가 오르지 않음 (${before}점 → ${review.score}점): ${review.fixes.join(' · ')} (${summary})`;
    if (ChatReview.wantsFix(review))
      return `${ChatInspect.FIX_MAX}번 고쳐도 남음: ${review.fixes.join(' · ')} (${summary})`;
    return ChatReview.line(review);
  }

  /**
   * 지시문 틀 result-inspect의 자리. message: 그 회차의 관리자 메시지, previous: 같은 대상에 앞서 고쳐 달라고 한 결재들
   */
  static fields(
    approval: Approval,
    goal: string | null,
    message: string,
    previous: readonly Approval[],
  ): Record<string, string | number | null> {
    const post = approval.action === ChatInspect.POST;
    return {
      goal,
      message: message || '-',
      item: `${ChatInspect.LABELS[approval.action] ?? approval.action}${approval.note ? ` · ${approval.note}` : ''}`,
      post: post ? approval.targetId : null,
      app: post ? null : approval.targetId,
      round: previous.length + 1,
      max: ChatInspect.FIX_MAX + 1,
      previous: previous.map((a, i) => `(${i + 1}번째 검수) ${a.note ?? '-'}`).join('\n\n') || null,
    };
  }

  /** 글이면 그 글 하나를 이 작업에서만 읽게 하는 참조 (초안이라 비공개) */
  private static refsOf(approval: Approval): TaskRefs {
    if (approval.action !== ChatInspect.POST) return TaskRefs.of(null);
    const line = {
      kind: 'post',
      id: approval.targetId,
      title: approval.note ?? '검수할 글',
      private: true,
      url: null,
      browser: false,
      image: false,
    };
    return TaskRefs.of({ refs: [line] });
  }
}
