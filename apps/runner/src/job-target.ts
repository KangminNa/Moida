import type { Json } from './json';

/** 일의 대상 (글 등). 대상이 없는 일이면 from이 null */
export class JobTarget {
  constructor(
    readonly kind: string,
    readonly id: string,
    readonly version: number | null,
  ) {}

  static from(target: Json): JobTarget | null {
    if (target.optionalText('kind') === null) return null;
    return new JobTarget(target.text('kind'), target.text('id'), target.optionalNumber('version'));
  }
}
