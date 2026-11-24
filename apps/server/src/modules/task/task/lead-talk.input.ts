import { BaseRequest } from '../../platform';
import { LeadTalk } from './lead-talk.policy';

/** MCP ask_lead의 입력: 일꾼이 대표에게 묻는 말 (2026-11-24 대표 ↔ 일꾼 대화) */
export class AskLeadInput extends BaseRequest {
  private constructor(readonly question: string) {
    super();
  }

  static from(raw: unknown): AskLeadInput {
    return BaseRequest.read(
      raw,
      (f) => new AskLeadInput(f.text('question', LeadTalk.QUESTION_MAX)),
    );
  }
}

/** MCP reply_worker의 입력: 대표가 답을 기다리는 일꾼들에게 한 번에 답한다 ({ task_id, text } 여럿) */
export class ReplyWorkersInput extends BaseRequest {
  private constructor(
    readonly replies: readonly { readonly taskId: string; readonly text: string }[],
  ) {
    super();
  }

  static from(raw: unknown): ReplyWorkersInput {
    return BaseRequest.read(raw, (f) => {
      const list = f.nestedList('replies', LeadTalk.REPLIES_MAX);
      if (list.length === 0) f.reject('replies', '답할 일꾼을 하나 이상 적어요');
      const replies = list.map((r) => ({
        taskId: r.uuid('task_id'),
        text: r.text('text', LeadTalk.REPLY_MAX),
      }));
      if (new Set(replies.map((r) => r.taskId)).size !== replies.length)
        f.reject('replies', '같은 일에 두 번 답하지 않아요');
      return new ReplyWorkersInput(replies);
    });
  }
}
