import { Conflict, RuleViolation } from '../../platform';
import type { TaskRow } from '../task.tables';

// 팀원 기다리기 (2026-11-19 사용자 요청 "팀원 기다리는 게 너무 오래 걸린다"). 위 작업은 하위 작업을 모두 기다리지 않는다:
//   기한(tasks.wait_until)이 지나거나 · 하위 작업 하나가 실패하거나 · 관리자가 "지금까지로 답하기"를 누르면 먼저 깬다.
// 깬 위 작업은 끝난 결과와 끝나지 않은 일(상태 · 맡긴 때)을 함께 받아 정한다:
//   지금까지로 마무리(끝나지 않은 하위 작업은 취소, 승인을 기다리는 일은 관리자가 정하게 둔다) ·
//   wait_subtasks로 더 기다리기(골라서 취소) · delegate_task로 더 맡기기.
// 깬 까닭은 payload.wake에 둔다 (next_jobs의 wake, 러너의 지시문). 관리자가 재촉하면(owner) 더 맡기거나 기다리지 못한다.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. Task · TaskService · DelegationPolicy가 쓴다
export class SubtaskWait {
  /** 하위 작업이 모두 끝남 (예전 그대로) */
  static readonly ALL = 'all';
  /** 하위 작업 하나가 실패: 형제를 기다리지 않고 바로 (다시 맡기기를 빨리) */
  static readonly FAILED = 'failed';
  /** 기한이 지남 */
  static readonly DEADLINE = 'deadline';
  /** 관리자가 지금까지로 답하라고 함 */
  static readonly OWNER = 'owner';
  /** 기한으로 고를 수 있는 분 */
  static readonly MINUTES_MAX = 120;
  /** 기한을 고르지 않았을 때 (분): 맡긴 일 가운데 가장 긴 종류의 값 */
  private static readonly MINUTES: Readonly<Record<string, number>> = {
    code: 40,
    make: 30,
    browse: 20,
  };
  private static readonly MINUTES_DEFAULT = 15;
  /** 모두 끝났는데 더 기다리겠다고 하면: 러너가 AI를 끌 틈(진행 보고 3초마다)을 두고 깨운다 */
  private static readonly GRACE_MS = 10_000;
  private static readonly NOTES = {
    all: '하위 작업이 모두 끝나 다시 대기열로 돌아갔어요',
    failed: '하위 작업 하나가 실패해 먼저 깨웠어요 (나머지는 계속 돌아요)',
    deadline: '기다리는 기한이 지나 지금까지의 결과로 깨웠어요',
    owner: '관리자가 지금까지의 결과로 답해 달라고 했어요',
  };

  /** 기한: 고른 분, 아니면 맡긴 일의 종류로 정한 분 */
  static until(now: Date, minutes: number | null, kinds: readonly string[]): Date {
    const byKind = kinds.map((k) => SubtaskWait.MINUTES[k] ?? 0);
    const chosen = minutes ?? Math.max(SubtaskWait.MINUTES_DEFAULT, ...byKind);
    return new Date(now.getTime() + chosen * 60_000);
  }

  /** 끝나지 않은 하위 작업이 없는데 기다리면: 러너가 AI를 끈 뒤에 바로 깨운다 */
  static soon(now: Date): Date {
    return new Date(now.getTime() + SubtaskWait.GRACE_MS);
  }

  /** 하위 작업 하나가 끝났을 때 위 작업을 깨울 까닭. null이면 계속 기다린다 */
  static wakeOn(status: string, open: number): string | null {
    if (open === 0) return SubtaskWait.ALL;
    return status === 'failed' ? SubtaskWait.FAILED : null;
  }

  /**
   * 더 기다릴 것이 남는가 (wait_subtasks). 남은 일을 모두 취소하면 기다리지 말고 마무리한다 (마무리하면 끝나지 않은 일은
   * 취소된다). 취소 없이 남은 것이 없으면(깬 뒤에 모두 끝남) 기다리기는 곧 깨워 그 결과를 받게 한다 (soon)
   */
  static assertLeft(left: number, cancelled: number): void {
    if (left === 0 && cancelled > 0)
      throw new RuleViolation(
        '남은 하위 작업이 없어요. 기다리지 말고 지금까지의 결과로 마무리해요 (마무리하면 끝나지 않은 일은 취소돼요)',
      );
  }

  static overdue(until: Date | null, now: Date): boolean {
    return until !== null && until.getTime() <= now.getTime();
  }

  /** 깬 까닭을 적은 payload */
  static woken(
    payload: Readonly<Record<string, unknown>>,
    reason: string,
  ): Record<string, unknown> {
    return { ...payload, wake: reason };
  }

  static noteOf(reason: string): string {
    const notes: Readonly<Record<string, string | undefined>> = SubtaskWait.NOTES;
    return notes[reason] ?? SubtaskWait.NOTES.all;
  }

  /** 지금까지로 답하라고 할 수 있는 작업: 대기 · 실행 중이거나 하위 작업을 기다리는 중 */
  static assertHurriable(row: Pick<TaskRow, 'status' | 'wait_reason'>): void {
    const ok =
      row.status === 'queued' ||
      row.status === 'running' ||
      (row.status === 'waiting' && row.wait_reason === 'subtasks');
    if (!ok) throw new Conflict(`팀원을 기다리는 작업이 아니에요 (${row.status})`);
  }

  /** 관리자가 재촉한 작업은 더 맡기거나 기다리지 않는다 */
  static assertNotHurried(payload: unknown): void {
    if ((payload as { wake?: unknown } | null)?.wake === SubtaskWait.OWNER)
      throw new RuleViolation(
        '관리자가 지금까지의 결과로 답해 달라고 했어요. 더 맡기거나 기다리지 말고 마무리해요',
      );
  }
}
