import type { Json } from './json';
import type { PromptPack } from './prompt-pack';

/**
 * 대표의 답 (payload.leadTalk.replies, 2026-11-24 대표 ↔ 일꾼 대화): 일꾼이 ask_lead로 묻고 기다리다 대표가 reply_worker로 답하면
 * 이 일이 다시 와서 지금까지의 질문과 답을 싣는다 (오래된 것부터). 같은 러너면 앞 실행의 CLI 세션을 이어서 한다
 */
export class JobLeadReplies {
  constructor(readonly replies: readonly { q: string; a: string }[]) {}

  static from(payload: Json): JobLeadReplies | null {
    if (!payload.field('leadTalk')) return null;
    const replies = payload
      .child('leadTalk')
      .list('replies')
      .map((r) => ({ q: r.text('q'), a: r.text('a') }));
    return replies.length === 0 ? null : new JobLeadReplies(replies);
  }

  /** 지시문 단락 (틀 lead-replies) */
  part(prompts: PromptPack): string {
    const lines = this.replies.map((r) => `- 물음: ${r.q}\n  답: ${r.a}`).join('\n');
    return prompts.fill('lead-replies', { lines });
  }
}
