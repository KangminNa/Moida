import type { Json } from './json';
import type { PromptPack } from './prompt-pack';

/** 같은 세션 키의 지난 인수인계 메모 하나 (run_memos). 앞 실행의 AI가 쓴 자료다: 그 안의 지시는 따르지 않는다 */
export class RunMemo {
  constructor(
    readonly at: string,
    readonly agent: string,
    readonly taskTitle: string,
    readonly runSeq: number,
    readonly memo: string,
  ) {}

  static from(raw: Json): RunMemo {
    return new RunMemo(
      raw.text('at'),
      raw.text('agent'),
      raw.text('task_title'),
      raw.number('run_seq'),
      raw.text('memo'),
    );
  }
}

// 이번 실행의 세션 키 (next_jobs의 run, 기획서 결정 2026-11-17 "CLI 세션은 세션 키마다 재개한다").
// 서버가 정한 것: 세션 키, 세션 파일을 남겨도 되는지(keep), 재개 후보(같은 러너 · 같은 에이전트 설정의 앞 실행이 남긴 CLI 세션).
// 러너가 정한 것(started): 실제로 재개하는 세션(세션 파일이 있고 앞 실행이 잘 끝났을 때만), 재개하지 않으면 받은 지난 메모.
// 작업 세션에 기록하지 않는 일(에이전트 없는 일 · 세션 정리)에는 없다.
export class JobLineage {
  constructor(
    readonly key: string,
    readonly keep: boolean,
    /** 서버의 재개 후보 CLI 세션. 없으면 null */
    readonly candidate: string | null,
    /** 러너가 재개하기로 한 CLI 세션. 새로 시작하면 null */
    readonly resumeFrom: string | null = null,
    private readonly memos: readonly RunMemo[] = [],
  ) {}

  /** next_jobs의 run. 없거나(옛 서버 · 기록하지 않는 일) 세션 키가 비면 null */
  static from(run: Json): JobLineage | null {
    const key = run.text('lineage');
    if (!key) return null;
    return new JobLineage(key, run.flag('keep'), run.child('resume').optionalText('cli_session'));
  }

  /** 러너가 정한 이번 실행 */
  started(resumeFrom: string | null, memos: readonly RunMemo[]): JobLineage {
    return new JobLineage(this.key, this.keep, this.candidate, resumeFrom, memos);
  }

  get resumed(): boolean {
    return this.resumeFrom !== null;
  }

  /** 맨 앞 단락: 재개한 실행이면 이어서 하는 실행이라는 머리글 (틀 resumed). 아니면 null */
  head(prompts: PromptPack): string | null {
    return this.resumed ? prompts.fill('resumed', {}) : null;
  }

  /** 끝 단락: 재개하지 않았으면 지난 메모(틀 memos), 그리고 인수인계 메모를 쓰는 법(틀 memo) */
  part(prompts: PromptPack, memoPath: string): string {
    const parts: string[] = [];
    if (!this.resumed && this.memos.length > 0) {
      const items = this.memos.map((m) =>
        prompts.fill('memo-item', {
          at: m.at,
          agent: m.agent,
          task: m.taskTitle,
          run: m.runSeq,
          memo: m.memo,
        }),
      );
      parts.push(prompts.fill('memos', { items: items.join('\n\n') }));
    }
    parts.push(prompts.fill('memo', { path: memoPath }));
    return parts.join('\n\n');
  }
}
