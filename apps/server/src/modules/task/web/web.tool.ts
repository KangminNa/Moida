import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { ReadUrlInput } from './web.input';
import { WebQuery } from './web.query';
import type { WebPageView } from './web.view';

// MCP 도구 read_url: 서버가 AI 대신 주소 하나를 열어 글자만 돌려준다. 작업 토큰으로만 부른다.
// 공개 주소 어디든 연다. 내부망 · 이 서버는 열지 않는다 (WebReach · WebPageGateway).
@Injectable()
export class ReadUrlTool extends BaseTool {
  readonly name = 'read_url';
  readonly scope = Actor.AGENT;
  readonly readOnly = true;
  override readonly idempotent = true;
  readonly inputSchema = {
    properties: {
      url: {
        type: 'string',
        maxLength: ReadUrlInput.URL_MAX,
      },
    },
    required: ['url'],
  };

  constructor(private readonly web: WebQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<WebPageView> {
    return this.web.readUrl(actor, ReadUrlInput.from(raw));
  }
}
