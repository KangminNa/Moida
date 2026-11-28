import type { RunMemoRow, SessionRow } from '../vault.tables';

// 콘솔의 세션 화면이 받는 모양 (camelCase). 러너가 받는 메모는 run-record.view.ts

/**
 * 작업 세션 화면 (S2): 요청의 열쇠(source_session_id: chat:<대화> · goal-run:<실행> · task:<작업>), 정리할 판(끝난 요청까지)과
 * 정리를 요청한 판, 인수인계 메모 (새것부터)
 */
export class WorkSessionView {
  constructor(
    private readonly row: Readonly<SessionRow>,
    private readonly memos: readonly Readonly<RunMemoRow>[],
  ) {}

  toJSON() {
    return {
      flow: this.row.source_session_id,
      revisionCount: this.row.revision_count,
      settledSeq: this.row.settled_seq,
      tidyRequestedSeq: this.row.tidy_requested_seq,
      wikiId: this.row.wiki_id,
      memos: this.memos.map((m) => ({
        id: m.id,
        at: m.created_at.toISOString(),
        agent: m.agent_name,
        taskId: m.task_id,
        taskTitle: m.task_title,
        runSeq: m.run_seq,
        transcriptSeq: m.transcript_seq,
        memo: m.memo,
        writtenBy: m.written_by,
      })),
    };
  }
}
