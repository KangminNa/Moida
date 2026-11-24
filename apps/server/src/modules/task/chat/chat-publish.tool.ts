import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { PublishAppInput } from './chat-publish.input';
import { ChatPublishService } from './chat-publish.service';
import type { AppPublishedView } from './chat-publish.view';
import { OwnerAsk } from './owner-ask.policy';

/** 관리자가 대화에서 요청한 앱 배포 · 수정 (2026-11-24): 대표가 관리자의 말을 그대로 인용한다 */
@Injectable()
export class PublishAppTool extends BaseTool {
  readonly name = 'publish_app';
  readonly scope = Actor.AGENT;
  readonly readOnly = false;
  readonly inputSchema = {
    properties: {
      app_id: { type: 'string', format: 'uuid' },
      quote: { type: 'string', minLength: OwnerAsk.QUOTE_MIN, maxLength: OwnerAsk.QUOTE_MAX },
    },
    required: ['app_id', 'quote'],
  };

  constructor(private readonly publish: ChatPublishService) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<AppPublishedView> {
    return this.publish.publish(actor, PublishAppInput.from(raw));
  }
}
