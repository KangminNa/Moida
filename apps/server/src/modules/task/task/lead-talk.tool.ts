import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { AskLeadInput, ReplyWorkersInput } from './lead-talk.input';
import { LeadTalk } from './lead-talk.policy';
import { LeadTalkService } from './lead-talk.service';
import type { LeadAskedView, WorkersRepliedView } from './lead-talk.view';

// MCP 도구 ask_lead (2026-11-24 대표 ↔ 일꾼 대화): 대표가 맡긴 일을 하는 일꾼이 대표에게 묻고 답을 기다린다. 이 실행은 여기서 끝난다
@Injectable()
export class AskLeadTool extends BaseTool {
  readonly name = 'ask_lead';
  readonly scope = Actor.AGENT;
  readonly readOnly = false;
  readonly inputSchema = {
    properties: { question: { type: 'string', maxLength: LeadTalk.QUESTION_MAX } },
    required: ['question'],
  };

  constructor(private readonly talk: LeadTalkService) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<LeadAskedView> {
    return this.talk.ask(actor, AskLeadInput.from(raw));
  }
}

// MCP 도구 reply_worker: 대표가 답을 기다리는 일꾼들에게 한 번에 답하고 다시 기다린다. 이 실행은 여기서 끝난다
@Injectable()
export class ReplyWorkerTool extends BaseTool {
  readonly name = 'reply_worker';
  readonly scope = Actor.AGENT;
  readonly readOnly = false;
  readonly inputSchema = {
    properties: {
      replies: {
        type: 'array',
        minItems: 1,
        maxItems: LeadTalk.REPLIES_MAX,
        items: {
          type: 'object',
          properties: {
            task_id: { type: 'string' },
            text: { type: 'string', maxLength: LeadTalk.REPLY_MAX },
          },
          required: ['task_id', 'text'],
        },
      },
    },
    required: ['replies'],
  };

  constructor(private readonly talk: LeadTalkService) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<WorkersRepliedView> {
    return this.talk.reply(actor, ReplyWorkersInput.from(raw));
  }
}
