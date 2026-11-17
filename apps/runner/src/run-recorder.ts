import { randomUUID } from 'node:crypto';
import type { AiStream } from './ai-tool';
import type { CairnServer } from './cairn-server';
import type { Job } from './job';
import type { JobLineage, RunMemo } from './job-lineage';
import type { JobWorkspace } from './job-workspace';
import type { LineagePlace, LineageStore } from './lineage-store';
import type { Redactor, RunLog } from './redactor';

/** save_run_record의 본문. 다시 보내도 한 번만 쌓이게 request_id를 들고 있다 */
export class RunRecordBody {
  /** 서버의 AgentRunRecord.MEMO_MAX */
  static readonly MEMO_MAX = 4_000;

  readonly requestId = randomUUID();

  constructor(
    readonly transcript: string,
    readonly memo: string,
    /** 메모를 쓴 쪽: AI가 메모 파일에 썼으면 ai, 러너가 대신 만들었으면 runner */
    readonly memoBy: 'ai' | 'runner',
    readonly resumed: boolean,
  ) {}

  toJSON(): object {
    return {
      request_id: this.requestId,
      transcript: this.transcript,
      memo: this.memo,
      memo_by: this.memoBy,
      resumed: this.resumed,
    };
  }
}

// 에이전트 실행의 기록 (작업 세션 · CLI 세션 재개, 기획서 결정 2026-11-17). JobRun의 앞뒤에서 부른다.
//   시작(begin)  세션 키의 고정 자리를 잡고(세션을 남기는 엔진 · 일만), 앞 실행의 CLI 세션을 재개할지 정한다.
//                재개하지 않으면 같은 세션 키의 지난 메모(run_memos)를 받아 지시문에 싣는다
//   끝(save)     CLI가 끝난 뒤, 결과를 내기 전에: 원문과 인수인계 메모(AI가 쓴 것, 없으면 러너가 대신)를
//                save_run_record로 쌓고, 고정 자리에 이번 CLI 세션을 남긴다. 남기지 못해도 일은 실패시키지 않는다
// 작업 세션에 기록하지 않는 일(next_jobs에 run이 없는 일, 작업 토큰이 없는 일)은 아무것도 하지 않는다.
export class RunRecorder {
  private place: LineagePlace | null = null;
  private lineage: JobLineage | null = null;

  constructor(
    private readonly server: CairnServer,
    private readonly store: LineageStore,
    /** 엔진이 CLI 세션을 남기고 재개하는가 (EngineAdapter.resumes) */
    private readonly resumes: boolean,
    private readonly log: RunLog,
    private readonly redactor: Redactor,
  ) {}

  /** 기록하는 일이면 이번 실행(재개할 세션 · 지난 메모)을 실은 일. 아니면 그대로 */
  async begin(job: Job): Promise<Job> {
    const lineage = job.lineage;
    if (lineage === null || job.runToken === null) return job;
    if (lineage.keep && this.resumes)
      this.place = await this.store.claim(lineage.key).catch((error: Error) => {
        this.log.info(`${job.taskId}: 세션 키의 자리를 잡지 못해 새로 시작해요: ${error.message}`);
        return null;
      });
    const resumeFrom = (await this.place?.resumable(lineage.candidate)) ?? null;
    const memos = resumeFrom === null ? await this.memos(job.taskId) : [];
    this.lineage = lineage.started(resumeFrom, memos);
    return job.withLineage(this.lineage);
  }

  /** begin이 정한 이번 실행을 다시 실은 일 (단계가 지시문을 새로 만들 때) */
  onto(job: Job): Job {
    return this.lineage === null ? job : job.withLineage(this.lineage);
  }

  /** 세션 키의 고정 자리. 잡지 않았으면 null (임시 자리에서 새로) */
  get kept(): LineagePlace | null {
    return this.place;
  }

  /**
   * 끝: 원문 · 인수인계 메모를 작업 세션에 쌓는다. endedOk: CLI가 잘 끝났거나 승인 · 위임으로 기다리게 되어 끈 것
   * (다음 실행이 재개해도 되는 세션). why: 끝난 까닭 (러너가 메모를 대신 쓸 때). 남기지 못했으면 그 까닭, 남겼으면 null
   */
  async save(
    job: Job,
    stream: AiStream,
    workspace: JobWorkspace,
    endedOk: boolean,
    why: string,
    persist: <T>(send: () => Promise<T>) => Promise<T>,
  ): Promise<string | null> {
    if (this.lineage === null) return null;
    await this.place?.remember(stream.sessionId, endedOk).catch(() => {});
    const written = await workspace.readMemo(RunRecordBody.MEMO_MAX);
    const memo = written || stream.transcript.fallbackMemo(stream.finalText, why);
    const body = new RunRecordBody(
      this.redactor.clean(stream.transcript.text(job.instruction)),
      this.redactor.clean(memo).slice(0, RunRecordBody.MEMO_MAX),
      written ? 'ai' : 'runner',
      this.lineage.resumed,
    );
    try {
      await persist(() => this.server.saveRunRecord(job.taskId, body));
      return null;
    } catch (error) {
      return `실행 기록을 작업 세션에 남기지 못했어요: ${(error as Error).message}`;
    }
  }

  /** 고정 자리를 놓는다 (일이 어떻게 끝나든) */
  async close(): Promise<void> {
    await this.place?.release();
    this.place = null;
  }

  /** 지난 메모. 받지 못하면 메모 없이 시작한다 */
  private async memos(taskId: string): Promise<readonly RunMemo[]> {
    try {
      return await this.server.runMemos(taskId);
    } catch (error) {
      this.log.info(`${taskId}: 지난 메모를 받지 못했어요: ${(error as Error).message}`);
      return [];
    }
  }
}
