import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { AgentRunRecord } from './agent-run-record';
import { RunMemosInput, SaveRunRecordInput } from './run-record.input';
import type { RunMemosView } from './run-record.view';
import { SessionQuery } from './session.query';
import { SessionService } from './session.service';
import type { TranscriptSavedView } from './session.view';

// 에이전트 실행의 기록 MCP 도구 (작업 세션, 기획서 결정 2026-11-17). 일을 쥔 러너만 부른다 (platform Leases.forRecord).
// 답은 snake_case, 설명은 vault.tools.ko.json.

/** 러너가 쥔 일의 id */
const TASK_ID = { task_id: { type: 'string', format: 'uuid' } };

// MCP 도구 run_memos: 실행을 시작할 때 같은 세션 키의 지난 인수인계 메모를 받는다 (CLI 세션을 재개하지 않을 때)
@Injectable()
export class RunMemosTool extends BaseTool {
  readonly name = 'run_memos';
  readonly scope = Actor.RUN;
  readonly readOnly = true;
  override readonly idempotent = true;
  readonly inputSchema = { properties: TASK_ID, required: ['task_id'] };

  constructor(private readonly sessions: SessionQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<RunMemosView> {
    return this.sessions.runMemos(actor, RunMemosInput.from(raw));
  }
}

// MCP 도구 save_run_record: CLI가 끝난 뒤 이번 실행의 원문과 인수인계 메모를 작업 세션에 쌓는다
@Injectable()
export class SaveRunRecordTool extends BaseTool {
  readonly name = 'save_run_record';
  readonly scope = Actor.RUN;
  readonly readOnly = false;
  override readonly idempotent = true;
  readonly inputSchema = {
    properties: {
      ...TASK_ID,
      request_id: { type: 'string', format: 'uuid' },
      transcript: { type: 'string', maxLength: AgentRunRecord.TRANSCRIPT_MAX },
      memo: { type: 'string', minLength: 1, maxLength: AgentRunRecord.MEMO_MAX },
      memo_by: { type: 'string', enum: ['ai', 'runner'] },
      resumed: { type: 'boolean' },
    },
    required: ['task_id', 'request_id', 'memo', 'memo_by', 'resumed'],
  };

  constructor(private readonly sessions: SessionService) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<TranscriptSavedView> {
    return (await this.sessions.saveRun(actor, SaveRunRecordInput.from(raw))).transcriptView();
  }
}
