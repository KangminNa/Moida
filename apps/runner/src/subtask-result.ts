import type { Json } from './json';
import type { PromptPack } from './prompt-pack';

/** 맡긴 하위 작업 하나의 결과. 하위 작업이 모두 끝나 깨어난 일에만 온다 */
export class SubtaskResult {
  /** 틀(subtask)이 이름을 아는 상태. 그 밖의 상태는 값 그대로 */
  private static readonly KNOWN: readonly string[] = ['done', 'failed', 'cancelled'];

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
  ) {}

  static from(raw: Json): SubtaskResult {
    return new SubtaskResult(
      raw.text('title'),
      raw.text('agent'),
      raw.text('status'),
      raw.optionalText('summary'),
      raw.optionalText('error'),
      raw.list('outputs').map((o) => `${o.text('name')} (output_id: ${o.text('id')})`),
      raw.optionalText('deliver'),
    );
  }

  /** 지시문의 한 덩이 (틀 subtask) */
  line(prompts: PromptPack): string {
    return prompts.fill('subtask', {
      done: this.status === 'done',
      failed: this.status === 'failed',
      cancelled: this.status === 'cancelled',
      other: SubtaskResult.KNOWN.includes(this.status) ? null : this.status,
      title: this.title,
      agent: this.agent,
      body: this.error ?? this.summary,
      outputs: this.outputs.join(', '),
      deliver: this.deliver,
    });
  }
}
