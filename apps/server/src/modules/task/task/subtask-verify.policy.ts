import type { Agent } from '../agent/agent';
import { ChatReview } from '../chat/chat-review.policy';
import type { TaskRow } from '../task.tables';

/** 검증 루프가 읽는 끝난 하위 작업 한 줄 */
export type VerifyRow = Pick<
  TaskRow,
  'id' | 'agent_id' | 'kind' | 'title' | 'instruction' | 'payload' | 'result' | 'request_id'
>;

/** 검증할 일꾼을 고를 때 보는 에이전트의 칸 (Agent 엔티티가 그대로 맞는다) */
type Member = Pick<Agent, 'id' | 'lead' | 'deleted' | 'paused' | 'tool' | 'reviewerId'>;

/** 다음 할 일: 검증 일 · 고칠 것을 들고 다시 · 없음 (그대로 대표에게) */
export type VerifyStep =
  | { kind: 'verify'; order: Record<string, unknown>; seed: Record<string, unknown> }
  | { kind: 'retry'; order: Record<string, unknown>; seed: Record<string, unknown> }
  | { kind: 'none' };

/**
 * 검증 루프 (L2, 2026-11-27, 기획서 결정 2026-11-17 "검증 루프"): 대표가 delegate_task의 verify로 고른 하위 작업은
 * 끝나면 다른 일꾼(검토자 짝 → 다른 AI 도구 → 다른 일꾼)이 검증하고, 판정(ChatReview와 같은 JSON)이 fix면
 * 같은 일꾼에게 고칠 것을 들려 다시 맡긴다. ROUND_MAX번까지, 점수가 오르지 않으면 멈춘다. 끝나면 대표가 모두를 받는다.
 * 같은 모델의 자기 검증은 같은 실수를 놓쳐서 검증은 맡은 일꾼이 아닌 쪽이 한다. 검증할 일꾼이 없으면 검증 없이 넘긴다
 */
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳 (SubtaskService가 부른다)
export class SubtaskVerify {
  static readonly ROUND_MAX = 3;
  /** 검증 일에 싣는 결과 글 · 지시의 길이 */
  private static readonly TEXT_MAX = 6_000;

  /** 끝난(done) 하위 작업 하나에서 다음 할 일 */
  static next(done: VerifyRow, org: readonly Member[]): VerifyStep {
    const p = SubtaskVerify.payloadOf(done);
    if (typeof p.verifyOf === 'string') return SubtaskVerify.afterCheck(done, p);
    if (p.verify !== true) return { kind: 'none' };
    const round = typeof p.round === 'number' ? p.round : 1;
    const verifier = SubtaskVerify.pickVerifier(done.agent_id, org);
    if (!verifier) return { kind: 'none' };
    return {
      kind: 'verify',
      order: {
        request_id: `verify:${done.id}`,
        to_agent_id: verifier.id,
        kind: 'general',
        title: `검증: ${done.title}`.slice(0, 200),
        instruction: '아래 하위 작업의 결과를 지시 · 받을 것에 비추어 검증하고 판정 JSON만 답한다.',
      },
      seed: {
        verifyOf: done.id,
        round,
        check: {
          title: done.title,
          instruction: SubtaskVerify.cut(done.instruction ?? ''),
          deliver: typeof p.deliver === 'string' ? p.deliver : null,
          result: SubtaskVerify.cut(SubtaskVerify.textOf(done)),
          worker: done.agent_id,
          original: typeof p.retryOf === 'string' ? p.retryOf : done.id,
          lastScore: typeof p.lastScore === 'number' ? p.lastScore : null,
        },
      },
    };
  }

  /** 검증 일이 끝났다: fix이고 점수가 올랐거나 처음이며 한도 안이면 같은 일꾼에게 다시 */
  private static afterCheck(done: VerifyRow, p: Record<string, unknown>): VerifyStep {
    const check = (p.check ?? {}) as Record<string, unknown>;
    const round = typeof p.round === 'number' ? p.round : 1;
    const verdict = ChatReview.parse(SubtaskVerify.textOf(done));
    const last = typeof check.lastScore === 'number' ? check.lastScore : null;
    const stalled = last !== null && verdict.score !== null && verdict.score <= last;
    if (verdict.verdict !== ChatReview.FIX || round >= SubtaskVerify.ROUND_MAX || stalled)
      return { kind: 'none' };
    const original = String(check.original ?? '');
    const worker = typeof check.worker === 'string' ? check.worker : null;
    if (!original || !worker) return { kind: 'none' };
    return {
      kind: 'retry',
      order: {
        request_id: `retry:${original}:${round + 1}`,
        to_agent_id: worker,
        kind: 'general',
        title: `고치기: ${String(check.title ?? '')}`.slice(0, 200),
        instruction: String(check.instruction ?? '') || '앞 결과를 검증의 고칠 것대로 고친다.',
        ...(typeof check.deliver === 'string' ? { deliver: check.deliver } : {}),
      },
      seed: {
        verify: true,
        retryOf: original,
        round: round + 1,
        lastScore: verdict.score,
        fixNote: {
          previous: SubtaskVerify.cut(String(check.result ?? '')),
          summary: verdict.summary,
          fixes: verdict.fixes,
        },
      },
    };
  }

  /** 검증할 일꾼: 맡은 일꾼의 검토자 짝 → 다른 AI 도구의 일꾼 → 다른 일꾼. 대표 · 지운 · 멈춘 일꾼은 빼고 */
  static pickVerifier(workerId: string | null, org: readonly Member[]): Member | null {
    const usable = org.filter((a) => !a.lead && !a.deleted && !a.paused && a.id !== workerId);
    const worker = org.find((a) => a.id === workerId) ?? null;
    const pair = worker?.reviewerId ? usable.find((a) => a.id === worker.reviewerId) : undefined;
    if (pair) return pair;
    return usable.find((a) => worker !== null && a.tool !== worker.tool) ?? usable[0] ?? null;
  }

  private static payloadOf(row: VerifyRow): Record<string, unknown> {
    return (row.payload ?? {}) as Record<string, unknown>;
  }

  private static textOf(row: VerifyRow): string {
    const text = (row.result as { text?: unknown } | null)?.text;
    return typeof text === 'string' ? text : '';
  }

  private static cut(text: string): string {
    return text.length > SubtaskVerify.TEXT_MAX
      ? `${text.slice(0, SubtaskVerify.TEXT_MAX)}…`
      : text;
  }
}
