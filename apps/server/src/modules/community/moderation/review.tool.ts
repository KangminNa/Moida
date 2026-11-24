import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { ReviewCaseInput } from './review.input';
import { ReviewQuery } from './review.query';
import type { ReviewCaseView } from './review.view';

// 일꾼이 신고된 글 · 댓글을 읽는다 (2026-11-24, 스토어 3-3 신고 검토). 판단 뒤의 제안은 propose_setting(setting moderation)으로.
// 신고 검토 일의 작업 토큰은 이 도구와 propose_setting만 본다 (task-kinds.json의 tools). 설명 · 칸 설명은 community.tools.ko.json에
@Injectable()
export class CommunityCaseTool extends BaseTool {
  readonly name = 'community_case';
  readonly scope = Actor.AGENT;
  readonly readOnly = true;
  readonly inputSchema = {
    properties: {
      app_id: { type: 'string', format: 'uuid' },
      topic_id: { type: 'string', format: 'uuid' },
      comment_id: { type: 'string', format: 'uuid' },
    },
    required: ['app_id'],
  };

  constructor(private readonly query: ReviewQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<ReviewCaseView> {
    return this.query.caseOf(actor, ReviewCaseInput.from(raw));
  }
}
