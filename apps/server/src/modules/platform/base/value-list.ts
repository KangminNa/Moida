// 값 목록으로 글자를 좁힌다 (리팩토링 R2). 목록은 DB의 값 목록 CHECK에서 만든 것(<모듈>.tables.ts의 `as const`)을 쓴다:
//   if (!ValueList.has(SCHEDULE_MODE, mode)) throw new RuleViolation(…);   // 여기서부터 mode는 ScheduleMode
// 배열의 includes는 좁혀 주지 않고, 목록이 유니온이면 글자를 넣을 수조차 없어 이 한 곳을 둔다.
// biome-ignore lint/complexity/noStaticOnlyClass: 모든 모듈이 같은 좁히기를 쓰는 한 곳
export class ValueList {
  /** 목록에 든 값인가 (맞으면 그 유니온으로 좁혀진다) */
  static has<V extends string>(values: readonly V[], value: unknown): value is V {
    return typeof value === 'string' && (values as readonly string[]).includes(value);
  }
}
