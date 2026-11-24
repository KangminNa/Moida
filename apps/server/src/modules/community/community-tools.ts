import { Injectable } from '@nestjs/common';
import type { BaseTool, ToolTextBody } from '../platform';
import texts from './community.tools.ko.json';
import { CommunityCaseTool } from './moderation/review.tool';

// community가 AI에게 여는 MCP 도구 목록 (2026-11-24, 스토어 3-3 신고 검토). 새 도구는 여기에만 더한다 (mcp 모듈은 모으기만 한다)
@Injectable()
export class CommunityTools {
  readonly tools: readonly BaseTool[];
  /** 도구의 설명 · 칸 설명 (AI가 읽는 글) */
  readonly texts: Readonly<Record<string, ToolTextBody>> = texts;

  constructor(caseTool: CommunityCaseTool) {
    this.tools = [caseTool];
  }
}
