import { RuleViolation } from '../../platform';
import { GoalRun } from '../goal-run/goal-run';
import type { TaskRow, TaskRunNew, TaskRunRow } from '../task.tables';
import { TaskKinds } from './task-kinds';

// 세션 키와 작업 세션 (기획서 결정 2026-11-17 "에이전트 실행의 기록은 작업 세션이다" · "CLI 세션은 세션 키마다 재개한다").
// 세션 키: 같은 키의 실행이 CLI 세션과 인수인계 메모를 이어 받는다.
//   대화의 일(회차 · 덧붙인 말의 답 · 검토 · 다시 맡김)은 chat:<대화>:<에이전트>, 목표 실행의 회차는 goal-run:<실행>,
//   나머지(하위 작업 포함)는 task:<작업>. 하위 작업이 끝나 깨어난 위 작업은 같은 작업이라 같은 키다.
// 작업 세션의 키 (vault의 세션 하나 = 요청 하나): 맨 위 작업의 chat:<대화> · goal-run:<실행> · task:<맨 위 작업>.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. RunRecord · TaskService · TaskQuery가 함께 쓴다
export class RunLineage {
  /** 세션 키. 기록하지 않는 일(에이전트 없는 일 · 세션 정리)은 null */
  static of(task: TaskRow): string | null {
    if (TaskKinds.UNRECORDED.includes(task.kind)) return null;
    const chat = RunLineage.chatOf(task);
    if (chat !== null && task.agent_id !== null) return `chat:${chat}:${task.agent_id}`;
    const run = GoalRun.runIdOfRequest(task.request_id);
    return run === null ? `task:${task.id}` : `goal-run:${run}`;
  }

  /** 작업 세션의 키. root는 맨 위 작업 */
  static flowOf(root: TaskRow): string {
    const chat = RunLineage.chatOf(root);
    if (chat !== null) return `chat:${chat}`;
    const run = GoalRun.runIdOfRequest(root.request_id);
    return run === null ? `task:${root.id}` : `goal-run:${run}`;
  }

  /**
   * 러너가 CLI 세션 파일을 남겨도 되는 일인가. 브라우저 일(로그인된 화면이 세션에 남는다, 개인정보 규칙 ③)과
   * 샌드박스 일(일마다 지우는 칸)은 남기지 않고 늘 새로 시작한다
   */
  static keeps(kind: string): boolean {
    return kind !== 'browse' && !TaskKinds.SANDBOXED.includes(kind);
  }

  /**
   * 재개할 CLI 세션 id: 같은 키의 바로 앞 실행(before)이 같은 러너 · 같은 에이전트 · 같은 설정 판이고 CLI 세션 id를 남겼으며,
   * 이번 일이 세션 파일을 남기는 일일 때만. 러너는 세션 파일이 있고 앞 실행이 잘 끝났을 때만 실제로 재개한다
   */
  static resumeOf(run: TaskRunNew, before: TaskRunRow | null, keeps: boolean): string | null {
    if (!keeps || before === null || before.cli_session === null) return null;
    const same =
      before.runner_id === run.runner_id &&
      before.agent_id === run.agent_id &&
      before.agent_revision === run.agent_revision;
    return same ? before.cli_session : null;
  }

  /**
   * 이 러너가 실행의 기록을 올릴 수 있는 작업인가: 그 러너가 잡았고, 진행 중이거나 기다리는 중(위임 · 승인 요청 뒤
   * CLI를 끈 다음)이며 작업 점유 시간이 남았다. 기다리는 동안 점유 시간은 늘지 않으니 CLI를 끈 바로 뒤에 올린다
   */
  static assertRecordable(task: TaskRow, runnerId: string, now: Date): void {
    if (task.leased_by !== runnerId) throw new RuleViolation('다른 러너가 맡은 작업이에요');
    if (task.status !== 'running' && task.status !== 'waiting')
      throw new RuleViolation(`진행 중인 작업이 아니에요 (${task.status})`);
    if (task.lease_until === null || task.lease_until.getTime() <= now.getTime())
      throw new RuleViolation('점유 시간이 끝난 작업이에요');
  }

  /** 대화의 일이면 그 대화 (payload.chat.chatId: 회차 · 덧붙인 말의 답 · 검토. 하위 작업에는 없다) */
  private static chatOf(task: TaskRow): string | null {
    const payload = (task.payload ?? {}) as Readonly<Record<string, unknown>>;
    const chat = (payload.chat ?? {}) as Readonly<Record<string, unknown>>;
    return typeof chat.chatId === 'string' && chat.chatId !== '' ? chat.chatId : null;
  }
}
