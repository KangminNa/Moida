import type { Json } from './json';
import type { PromptPack } from './prompt-pack';

/**
 * 맡긴 하위 작업 하나의 결과. 깨어난 일에만 온다. 먼저 깨어났으면(실패 · 기한 · 관리자 재촉, 팀원 기다리기 2026-11-19)
 * 끝나지 않은 일도 상태 · 맡긴 때 · task_id와 함께 온다 (wait_subtasks의 cancel에 쓴다)
 */
export class SubtaskResult {
  /** 틀(subtask)이 이름을 아는 상태. 그 밖의 상태는 값 그대로 */
  private static readonly KNOWN: readonly string[] = ['done', 'failed', 'cancelled'];
  /** 끝나지 않은 일의 화면 말 (승인 · 아래 팀을 기다리는 일은 waiting의 까닭으로) */
  private static readonly OPEN: Readonly<Record<string, string>> = {
    queued: '대기열',
    running: '일하는 중',
    approval: '승인 기다림',
    subtasks: '아래 팀 기다림',
  };

  constructor(
    readonly title: string,
    readonly agent: string,
    readonly status: string,
    readonly summary: string | null,
    readonly error: string | null,
    /** 그 작업이 만든 결과물 (이름 · id). 보고(report_round)의 근거로 output_id를 건다 */
    readonly outputs: readonly string[] = [],
    /** 맡길 때 정한 결과 형식 (delegate_task의 deliver). 받은 결과를 이것과 견준다 */
    readonly deliver: string | null = null,
    readonly taskId = '',
    /** 기다리는 것 (approval · subtasks). 기다리는 중이 아니면 null */
    readonly waiting: string | null = null,
    /** 맡긴 때 (몇 분째인지 센다). 옛 서버면 null */
    readonly since: Date | null = null,
    /** 끝나지 않은 일의 최근 진행 기록 · 도움 요청 줄 (2026-11-20, 오래된 것부터). 어디까지 됐는지 보고 나눠 맡긴다 */
    readonly progress: readonly string[] = [],
  ) {}

  /** 아직 끝나지 않은 일의 화면 말. 끝났으면 null */
  get open(): string | null {
    if (SubtaskResult.KNOWN.includes(this.status)) return null;
    return SubtaskResult.OPEN[this.waiting ?? this.status] ?? null;
  }

  static from(raw: Json): SubtaskResult {
    return new SubtaskResult(
      raw.text('title'),
      raw.text('agent'),
      raw.text('status'),
      raw.optionalText('summary'),
      raw.optionalText('error'),
      raw.list('outputs').map((o) => `${o.text('name')} (output_id: ${o.text('id')})`),
      raw.optionalText('deliver'),
      raw.text('task_id'),
      raw.optionalText('waiting'),
      SubtaskResult.dateOf(raw.optionalText('since')),
      raw.texts('progress'),
    );
  }

  private static dateOf(text: string | null): Date | null {
    const at = text === null ? Number.NaN : Date.parse(text);
    return Number.isNaN(at) ? null : new Date(at);
  }

  /**
   * 지시문의 "맡긴 하위 작업의 결과" 단락 (틀 subtasks). wake: 깬 까닭 (next_jobs의 wake: all · failed · deadline · owner · help).
   * 끝나지 않은 일이 있으면 고르는 법(마무리 · 더 기다리기 · 다시 맡기기)을, 관리자가 재촉했으면 마무리만 싣는다
   */
  static part(
    prompts: PromptPack,
    results: readonly SubtaskResult[],
    wake: string | null,
    rounds: number,
  ): string {
    const owner = wake === 'owner';
    return prompts.fill('subtasks', {
      results: results.map((r) => r.line(prompts)).join('\n'),
      failedWake: wake === 'failed',
      deadline: wake === 'deadline',
      helpWake: wake === 'help',
      owner,
      open: !owner && results.some((r) => r.open !== null),
      rounds: String(rounds),
    });
  }

  /** 지시문의 한 덩이 (틀 subtask) */
  line(prompts: PromptPack, now = new Date()): string {
    const open = this.open;
    const minutes = this.since === null ? 0 : (now.getTime() - this.since.getTime()) / 60_000;
    return prompts.fill('subtask', {
      done: this.status === 'done',
      failed: this.status === 'failed',
      cancelled: this.status === 'cancelled',
      open,
      minutes: String(Math.max(0, Math.floor(minutes))),
      taskId: this.taskId,
      other: SubtaskResult.KNOWN.includes(this.status) || open !== null ? null : this.status,
      title: this.title,
      agent: this.agent,
      body: this.error ?? this.summary,
      outputs: this.outputs.join(', '),
      deliver: this.deliver,
      progress: open === null ? null : this.progress.map((line) => `- ${line}`).join('\n') || null,
    });
  }
}
