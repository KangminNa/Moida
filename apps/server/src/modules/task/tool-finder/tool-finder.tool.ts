import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { FindToolInput } from './tool-finder.input';
import { ToolFinderQuery } from './tool-finder.query';
import type { FoundToolsView } from './tool-finder.view';

/** MCP find_tool (2026-11-24): 필요한 서비스의 MCP 서버를 공식 레지스트리에서 찾는다. 설명은 task.tools.ko.json */
@Injectable()
export class FindToolTool extends BaseTool {
  readonly name = 'find_tool';
  readonly scope = Actor.AGENT;
  readonly readOnly = true;
  readonly inputSchema = {
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 60 },
      domain: { type: 'string', maxLength: 200 },
    },
    required: ['query'],
  };

  constructor(private readonly finder: ToolFinderQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<FoundToolsView> {
    return this.finder.find(actor, FindToolInput.from(raw));
  }
}
