import type { RunResult } from './progress';

/** 실행을 어떻게 끝낼지. 서버에 보낼 것이 없으면 note만 남긴다 (JobRun과 칸의 단계가 정한다) */
export class RunEnding {
  private constructor(
    readonly note: string,
    /** release_job의 이유 */
    readonly releaseReason: string | null,
    /** submit_result */
    readonly result: RunResult | null,
  ) {}

  static quiet(note: string): RunEnding {
    return new RunEnding(note, null, null);
  }

  static release(reason: string): RunEnding {
    return new RunEnding(reason, reason, null);
  }

  static submit(note: string, result: RunResult): RunEnding {
    return new RunEnding(note, null, result);
  }

  /** 잘 끝나 결과를 낼 끝인가 */
  get succeeded(): boolean {
    return this.result?.status === 'done';
  }
}
