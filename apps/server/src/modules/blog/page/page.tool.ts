import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { PageBaseInput } from './page.input';
import { PageQuery } from './page.query';
import type { PageBaseView } from './page.view';

// MCP 도구 page_base (2차 5단계 자라는 페이지): 러너가 쥔 만들기 일이 고칠 페이지의 가장 새 판 · 방향을 받는다.
// 러너가 글 파일을 작업 자리에 두고, AI는 바꿀 파일만 다시 낸다 (내지 않은 파일은 앞 판 그대로). run 권한 · 쥔 일만
@Injectable()
export class PageBaseTool extends BaseTool {
  readonly name = 'page_base';
  readonly scope = Actor.RUN;
  readonly readOnly = true;
  override readonly idempotent = true;
  readonly inputSchema = {
    properties: { task_id: { type: 'string', format: 'uuid' } },
    required: ['task_id'],
  };

  constructor(private readonly pages: PageQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<PageBaseView> {
    return this.pages.base(actor, PageBaseInput.from(raw));
  }
}
