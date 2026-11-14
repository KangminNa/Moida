import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { ExternalTool } from './external-tool';
import { ProposeToolInput } from './external-tool.input';
import { ExternalToolService } from './external-tool.service';
import type { ProposedToolView } from './external-tool.view';
import { ExternalToolUrl } from './external-tool-url.policy';

// MCP 도구 propose_tool (2차 7단계, 작업 토큰): 일에 필요한 바깥 서비스의 MCP 서버를 제안한다.
// 제안은 proposed로 남고, AI는 답의 tool_id · version으로 request_approval(task.tool.plug)을 올린다. 승인되면 이 에이전트에 붙는다.
// 토큰은 받지 않는다: 토큰이 필요한 도구는 관리자가 승인 뒤 도구 화면에서 넣는다.
@Injectable()
export class ProposeToolTool extends BaseTool {
  readonly name = 'propose_tool';
  readonly scope = Actor.AGENT;
  readonly readOnly = false;
  readonly inputSchema = {
    properties: {
      request_id: { type: 'string', format: 'uuid' },
      name: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,29}$' },
      title: { type: 'string', maxLength: ExternalTool.TITLE_MAX },
      url: { type: 'string', maxLength: ExternalToolUrl.MAX },
      header_name: { type: 'string', maxLength: 40 },
      note: { type: 'string', maxLength: ExternalTool.NOTE_MAX },
    },
    required: ['request_id', 'name', 'title', 'url', 'note'],
  };

  constructor(private readonly tools: ExternalToolService) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<ProposedToolView> {
    return (await this.tools.propose(actor, ProposeToolInput.from(raw))).proposedView();
  }
}
