// 일꾼이 깰 시각을 잡는 타이머 (리팩토링 2단계 worker 정책). 이름(키)마다 타이머 하나: 새로 잡으면 앞의 것을 바꾼다.
// setTimeout은 약 24.8일(2^31-1 ms)보다 긴 지연을 받지 못해 바로 불러 버린다: 넘는 시각은 한도에서 깨어 다시 잰다.
export class WorkScheduler {
  private static readonly MAX_DELAY_MS = 2 ** 31 - 1;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private stopped = false;

  /** when에 run을 부른다. null이면 이 키의 타이머를 끈다. 지난 시각이면 바로 (다음 차례에) 부른다 */
  at(key: string, when: Date | null, run: () => void): void {
    const before = this.timers.get(key);
    if (before) clearTimeout(before);
    this.timers.delete(key);
    if (when === null || this.stopped) return;
    const delay = Math.max(0, when.getTime() - Date.now());
    const timer = setTimeout(
      () => {
        this.timers.delete(key);
        if (delay > WorkScheduler.MAX_DELAY_MS) this.at(key, when, run);
        else run();
      },
      Math.min(delay, WorkScheduler.MAX_DELAY_MS),
    );
    this.timers.set(key, timer);
  }

  /** 모든 타이머를 끄고 더 잡지 않는다 (내려갈 때) */
  stop(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
