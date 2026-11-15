import { AsyncLocalStorage } from 'node:async_hooks';

// 지금 하는 일의 추적 번호 (리팩토링 R1, 2026-11-16). 요청의 번호(RequestTrace, X-Request-Id)가 outbox를 지나 일꾼까지 이어진다:
//   입구    HttpSetup이 본문을 읽은 뒤 요청 번호 안에서 다음 단계를 부른다
//   outbox  Outbox.publish가 지금 번호를 trace_id에 적는다
//   일꾼    이벤트의 trace_id 안에서 받는 쪽을 부른다. 반복 · 마감 작업은 돌 때마다 새 번호
// AsyncLocalStorage는 비동기 흐름마다 저장소가 따로라 동시 요청이 섞이지 않는다 (trace.api 시험).
// 추적 번호 하나에만 쓴다: 권한 · 업무 값은 지금처럼 Actor로 인자에 넘긴다 (리팩토링계획 3장).
// biome-ignore lint/complexity/noStaticOnlyClass: 입구 · outbox · 일꾼이 같은 번호를 읽는 한 곳
export class Trace {
  private static readonly store = new AsyncLocalStorage<string>();

  /** 이 번호 안에서 일을 한다 (안에서 시작한 비동기 일까지) */
  static run<T>(id: string, work: () => T): T {
    return Trace.store.run(id, work);
  }

  /** 지금 번호. 번호 밖이면 null */
  static current(): string | null {
    return Trace.store.getStore() ?? null;
  }
}
