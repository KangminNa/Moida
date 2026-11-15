// 일꾼이 마감에 맞춰 돌리는 일 (리팩토링 2단계 worker 정책). 할 일이 없으면 DB를 조회하지 않는다:
// 때가 된 일을 하고 다음에 할 일이 생기는 시각을 돌려주면, 일꾼이 그때까지 잔다.
// 마감을 바꾸는 쓰기는 일꾼을 깨운다: 이벤트가 있으면 CoreWorkers.due의 주제로, 없으면 같은 트랜잭션에서 Outbox.wake(이름).
// 두 번 불려도(일꾼이 깨어나 겹쳐도) 결과가 같아야 한다.
export abstract class BaseDueJob {
  /** Outbox.wake에 쓰는 이름 */
  abstract readonly name: string;
  /** 때가 된 일을 하고, 다음에 깰 시각을 돌려준다. null이면 깨우는 신호가 올 때까지 잔다 (지난 시각이면 바로 다시 돈다) */
  abstract run(now: Date): Promise<Date | null>;
}
