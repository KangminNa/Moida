import { BaseRequest } from '../../platform';

/** POST /api/runners/:id/accepting: 일 받기 켜기·끄기. 본 version을 함께 보낸다 (낙관적 잠금) */
export class RunnerAcceptingInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly accepting: boolean,
  ) {
    super();
  }

  static from(id: string, raw: unknown): RunnerAcceptingInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) => new RunnerAcceptingInput(f.uuid('id'), f.version(), f.boolean('accepting')),
    );
  }
}

/** POST /api/runners/:id/concurrency: 동시에 하는 일의 수 (1~8, null은 러너의 기본). 본 version을 함께 보낸다 */
export class RunnerConcurrencyInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly concurrency: number | null,
  ) {
    super();
  }

  static from(id: string, raw: unknown): RunnerConcurrencyInput {
    const given = (raw as { concurrency?: unknown } | null)?.concurrency;
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new RunnerConcurrencyInput(
          f.uuid('id'),
          f.version(),
          given === null ? null : f.integer('concurrency', 1, 8),
        ),
    );
  }
}
