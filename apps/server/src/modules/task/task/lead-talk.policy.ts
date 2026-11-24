import { RuleViolation } from '../../platform';
import type { TaskWaitReason } from '../task.tables';
import { SubtaskWait } from './subtask-wait.policy';

/** payload.leadTalk의 모양: 지금 기다리는 질문과 지금까지 받은 답 (오래된 것부터) */
interface LeadTalkState {
  readonly asked: number;
  readonly question: string | null;
  readonly replies: readonly { readonly q: string; readonly a: string }[];
}

// 대표 ↔ 일꾼 대화 (2026-11-24, 사용자 요청 "대표가 하위 에이전트들과 소통하면서 일을 시킬 수 있도록"):
//   일꾼(맡긴 일)이 MCP ask_lead로 묻는다 → 그 일은 답을 기다리고(waiting lead) 대표가 하위 작업을 기다리는 중이면 먼저 깨운다 (까닭 question)
//   대표가 MCP reply_worker로 답한다 → 일꾼의 일은 대기열로 돌아가 답을 받아 이어서 하고, 대표는 다시 기다린다 (위임 라운드를 쓰지 않는다)
// 질문 · 답은 일꾼의 일 payload.leadTalk에 남는다 (러너가 그 일의 payload에서 읽어 "# 대표의 답"으로 그린다). 규칙은 여기 한 곳
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. Task · LeadTalkService가 쓴다
export class LeadTalk {
  /** 일꾼이 대표의 답을 기다리는 까닭 (tasks.wait_reason) */
  static readonly WAIT = 'lead' satisfies TaskWaitReason;
  /** 일 하나에서 물을 수 있는 수 (되풀이로 대표를 계속 깨우지 않게) */
  static readonly ASK_MAX = 3;
  static readonly QUESTION_MAX = 1000;
  static readonly REPLY_MAX = 2000;
  /** 한 번에 답할 수 있는 일꾼 수 */
  static readonly REPLIES_MAX = 5;

  /** 묻는다: 한도 안에서 질문을 적는다. 이미 기다리는 질문이 있으면 (같은 실행에서 두 번) 거절 */
  static asked(
    payload: Readonly<Record<string, unknown>>,
    question: string,
  ): Record<string, unknown> {
    const state = LeadTalk.of(payload);
    const text = question.trim();
    if (text === '' || text.length > LeadTalk.QUESTION_MAX)
      throw new RuleViolation(`질문은 1~${LeadTalk.QUESTION_MAX}자예요`);
    if (state.asked >= LeadTalk.ASK_MAX)
      throw new RuleViolation(
        `대표에게는 일 하나에서 ${LeadTalk.ASK_MAX}번까지 물어요. 남은 것은 짐작한 것으로 결과에 적어요`,
      );
    return { ...payload, leadTalk: { ...state, asked: state.asked + 1, question: text } };
  }

  /** 답한다: 기다리던 질문과 함께 답을 쌓고 질문을 비운다 */
  static answered(
    payload: Readonly<Record<string, unknown>>,
    reply: string,
  ): Record<string, unknown> {
    const state = LeadTalk.of(payload);
    const text = reply.trim();
    if (state.question === null) throw new RuleViolation('대표에게 물은 것이 없는 일이에요');
    if (text === '' || text.length > LeadTalk.REPLY_MAX)
      throw new RuleViolation(`답은 1~${LeadTalk.REPLY_MAX}자예요`);
    const replies = [...state.replies, { q: state.question, a: text }];
    return { ...payload, leadTalk: { ...state, question: null, replies } };
  }

  /** 답한 뒤 대표가 다시 기다려도 되는가: 관리자가 재촉했으면 더 기다리지 않고 마무리한다 (payload는 그대로) */
  static rewaitable(payload: Readonly<Record<string, unknown>>): Record<string, unknown> {
    SubtaskWait.assertNotHurried(payload);
    return { ...payload };
  }

  /** 지금 기다리는 질문 (깬 대표의 subtask_results에 결과 글 대신 실린다) */
  static questionOf(payload: Readonly<Record<string, unknown>>): string | null {
    return LeadTalk.of(payload).question;
  }

  static askLine(question: string): string {
    return `대표에게 물음: ${question.trim()}`;
  }

  static answerLine(reply: string): string {
    return `대표의 답: ${reply.trim()}`;
  }

  private static of(payload: Readonly<Record<string, unknown>>): LeadTalkState {
    const raw = (payload.leadTalk ?? {}) as Partial<LeadTalkState>;
    return {
      asked: typeof raw.asked === 'number' ? raw.asked : 0,
      question: typeof raw.question === 'string' ? raw.question : null,
      replies: Array.isArray(raw.replies) ? raw.replies : [],
    };
  }
}
