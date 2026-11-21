import { Actor, Conflict, Forbidden, RuleViolation } from '../../platform';
import type { TaskRow } from '../task.tables';

// 팀원 기다리기 (2026-11-19 사용자 요청 "팀원 기다리는 게 너무 오래 걸린다"). 위 작업은 하위 작업을 모두 기다리지 않는다:
//   기한(tasks.wait_until)이 지나거나 · 하위 작업 하나가 실패하거나 · 관리자가 "지금까지로 답하기"를 누르면 먼저 깬다.
// 깬 위 작업은 끝난 결과와 끝나지 않은 일(상태 · 맡긴 때)을 함께 받아 정한다:
//   지금까지로 마무리(끝나지 않은 하위 작업은 취소, 승인을 기다리는 일은 관리자가 정하게 둔다) ·
//   wait_subtasks로 더 기다리기(골라서 취소) · delegate_task로 더 맡기기.
// 깬 까닭은 payload.wake에 둔다 (next_jobs의 wake, 러너의 지시문). 관리자가 재촉하면(owner) 더 맡기거나 기다리지 못한다.
// 도움 요청 (2026-11-20): 맡겨진 팀원이 일이 커서 나눌 부분을 적으면(MCP ask_help) 실행 기록 한 줄로 남기고 팀장을 먼저
// 깨운다(help). 팀장은 끝나지 않은 일마다 최근 진행 기록(그 줄 포함)을 받아 다른 팀원에게 나눠 맡긴다.
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
  /** 팀원이 나눌 부분을 적어 도움을 청함 */
  static readonly HELP = 'help';
  /** 관리자가 팀의 판단을 바꿈 (L1 중간 판단 알림): 바꾼 말은 회차의 덧붙인 말로 이 실행에 실린다 */
  static readonly CHANGE = 'change';
  /** 도움 요청 한 줄의 앞머리 (실행 기록에서 진행 기록과 구분한다) */
  static readonly HELP_PREFIX = '도움 요청: ';
  /** 일 하나가 청할 수 있는 도움의 수 · 나눌 부분의 길이 */
  static readonly HELP_MAX = 2;
  static readonly HELP_TEXT_MAX = 1000;
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
    help: '일꾼이 나눌 부분을 적어 도움을 청해 먼저 깨웠어요 (나머지는 계속 돌아요)',
    change: '관리자가 팀의 판단을 바꿔 먼저 깨웠어요 (나머지는 계속 돌아요)',
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

  /** 도움을 청할 수 있는 일: 이 에이전트가 살아 있는 임대로 일하는 중이고, 팀장이 맡긴 일(위 작업이 있음) */
  static assertHelpable(
    row: Pick<TaskRow, 'agent_id' | 'status' | 'parent_id'>,
    agentId: string,
    leaseAlive: boolean,
  ): void {
    if (row.agent_id !== agentId) throw new Forbidden(Actor.AGENT, '이 에이전트의 작업이 아니에요');
    if (row.status !== 'running' || !leaseAlive)
      throw new Conflict(`실행 중인 작업이 아니에요 (${row.status})`);
    if (row.parent_id === null)
      throw new RuleViolation('대표가 맡긴 일에서만 도움을 청해요. 맨 위 일은 직접 나눠 맡겨요');
  }

  /** 이미 청한 수가 한도면 RuleViolation */
  static assertHelpLeft(asked: number): void {
    if (asked >= SubtaskWait.HELP_MAX)
      throw new RuleViolation(
        `도움은 일 하나에 ${SubtaskWait.HELP_MAX}번까지예요. 나머지는 직접 끝내요`,
      );
  }

  /** 실행 기록에 남기는 도움 요청 한 줄 */
  static helpLine(part: string): string {
    return `${SubtaskWait.HELP_PREFIX}${part}`;
  }

  /** 관리자가 재촉한 작업은 더 맡기거나 기다리지 않는다 */
  static assertNotHurried(payload: unknown): void {
    if ((payload as { wake?: unknown } | null)?.wake === SubtaskWait.OWNER)
      throw new RuleViolation(
        '관리자가 지금까지의 결과로 답해 달라고 했어요. 더 맡기거나 기다리지 말고 마무리해요',
      );
  }
}
