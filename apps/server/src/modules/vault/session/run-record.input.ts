import { BaseRequest, ValueList } from '../../platform';
import { RUN_MEMO_WRITTEN_BY } from '../vault.tables';
import { AgentRunRecord } from './agent-run-record';

/** 같은 세션 키의 지난 인수인계 메모 (MCP `run_memos`, 2026-11-17): 러너가 쥔 일의 id */
export class RunMemosInput extends BaseRequest {
  private constructor(readonly taskId: string) {
    super();
  }

  static from(raw: unknown): RunMemosInput {
    return BaseRequest.read(raw, (f) => new RunMemosInput(f.uuid('task_id')));
  }
}

/**
 * 에이전트 실행의 기록 (MCP `save_run_record`, 2026-11-17): 러너가 CLI가 끝난 뒤 원문과 인수인계 메모를 보낸다.
 * memo_by: 메모를 AI가 썼는지(ai), AI가 쓰지 못해 러너가 대신 만들었는지(runner). resumed: 앞 실행의 CLI 세션을 재개했는지
 */
export class SaveRunRecordInput extends BaseRequest {
  private constructor(
    readonly taskId: string,
    readonly requestId: string,
    readonly transcript: string,
    readonly memo: string,
    readonly memoBy: (typeof RUN_MEMO_WRITTEN_BY)[number],
    readonly resumed: boolean,
  ) {
    super();
  }

  static from(raw: unknown): SaveRunRecordInput {
    return BaseRequest.read(raw, (f) => {
      const by = f.text('memo_by', 10);
      if (!ValueList.has(RUN_MEMO_WRITTEN_BY, by))
        f.reject('memo_by', `${RUN_MEMO_WRITTEN_BY.join(' · ')} 중 하나예요`);
      return new SaveRunRecordInput(
        f.uuid('task_id'),
        f.uuid('request_id'),
        f.optionalText('transcript', AgentRunRecord.TRANSCRIPT_MAX) ?? '',
        f.text('memo', AgentRunRecord.MEMO_MAX),
        ValueList.has(RUN_MEMO_WRITTEN_BY, by) ? by : 'runner',
        f.boolean('resumed'),
      );
    });
  }
}
