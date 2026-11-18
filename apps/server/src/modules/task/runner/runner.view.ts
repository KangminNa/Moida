import type { RunnerRow } from '../task.tables';

// 러너의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 이름·종류(서버 러너인지)는 기기 목록(api/devices)에 있고, 화면이 deviceId로 합친다.

/** 러너 하나. 지금 하는 일(task_id · task_title)과 쥔 브라우저 작업(browse_running)은 목록에서만 함께 읽는다 */
export class RunnerView {
  constructor(
    private readonly row: Readonly<
      RunnerRow & {
        task_id?: string | null;
        task_title?: string | null;
        browse_running?: boolean;
      }
    >,
    /** 마지막으로 닿은 지 90초 안 */
    private readonly online: boolean,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      deviceId: r.device_id,
      /** 일 받기 */
      accepting: r.accepting,
      /** 코드 러너 칸 (에이전트를 묶을 수 없다) */
      sandbox: r.sandbox,
      /**
       * 서버 브라우저에 붙은 러너 (O-1): next_jobs에서 마지막으로 알린 값, 또는 실행 중인 브라우저 작업을 쥐고 있음
       * (사이트 일이 도는 동안 러너는 거짓을 알린다)
       */
      browser: r.browser || r.browse_running === true,
      online: this.online,
      lastSeenAt: r.last_seen_at.toISOString(),
      task: r.task_id ? { id: r.task_id, title: r.task_title ?? '' } : null,
      version: r.version,
    };
  }
}

/** 러너 목록. 몇 개뿐이라 한 번에 보낸다 */
export class RunnerListView {
  constructor(private readonly runners: readonly RunnerView[]) {}

  toJSON() {
    return { runners: this.runners.map((r) => r.toJSON()), next: null };
  }
}
