import { Actor, Forbidden, RuleViolation } from '../../platform';
import type { Agent } from '../agent/agent';
import { ModelTier } from '../agent/model-tier.policy';
import type { TaskNew, TaskRow } from '../task.tables';
import { CodeScope } from './code-scope';
import type { SubtaskOrder } from './task.input';
import { TaskKinds } from './task-kinds';
import { TaskRefs } from './task-refs.policy';

// 위임 하나의 판단 (Task.assertCanDelegate · subtask가 부른다): 한도와 하위 작업의 모양. 받는 쪽 · 종류 · 권한은 코드가 막고 LLM에게 맡기지 않는다.
// 브라우저 일(browse, 2차 3단계 2026-11-14)은 맡기는 쪽도 비공개(전체 읽기 · 초안 작성)를 읽지 못해야 한다:
// 맡기는 쪽이 쓴 지시문이 곧 브라우저 담당의 재료라서, 비공개가 지시문을 타고 바깥 사이트로 갈 수 있다.
// 그런 에이전트는 브라우저 일을 맡기지 못하고, 관리자가 브라우저 메뉴에서 맡긴다.
// O-2 (2026-11-18): 대표는 비공개를 읽지 않지만 대화 안에서 비공개를 읽은 팀의 결과를 받는다. 그래서 대화 단위로 본다:
// 그 대화(대화가 아니면 맨 위 작업의 나무)가 비공개를 읽었으면(tainted, TaskRepository.privateTouched) 아무도 브라우저 일을 맡기지 못한다
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳
export class DelegationPolicy {
  /** 위임 한도: 깊이(주인이 맡긴 작업이 0), 작업 하나가 위임하는 횟수, 한 번에, 작업 하나에 */
  static readonly DEPTH_MAX = 3;
  static readonly ROUNDS_MAX = 3;
  static readonly DELEGATE_AT_ONCE = 5;
  static readonly SUBTASKS_MAX = 10;
  /** 브라우저 일을 맡기는 쪽에게 없어야 하는 권한 (browse와 함께 줄 수 없는 권한과 같다) */
  private static readonly NOT_WITH_BROWSE: readonly string[] = [Actor.READ_ALL, Actor.WRITE];

  /** 이 권한을 가진 에이전트에게 맡길 수 있는 일의 종류 (팀원 정보의 kinds) */
  static kindsFor(scopes: readonly string[]): readonly string[] {
    return TaskKinds.DELEGABLE.filter((kind) =>
      (TaskKinds.SCOPES[kind] ?? []).every((scope) => scopes.includes(scope)),
    );
  }

  /**
   * 받는 쪽은 manager의 바로 아래 팀원, 종류는 위임할 수 있는 것(delegable), 받는 쪽은 그 일에 필요한 권한(needs)을 가졌는가.
   * 필요한 권한에 browse가 있으면 맡기는 쪽에게 전체 읽기 · 초안 작성이 없어야 하고, 이 일의 대화가 비공개를 읽지 않았어야 한다
   */
  static assert(
    manager: Agent,
    worker: Agent | null,
    kind: string,
    delegable: readonly string[],
    needs: readonly string[],
    tainted = false,
  ): asserts worker is Agent {
    if (worker === null || !manager.manages(worker))
      throw new Forbidden(Actor.AGENT, '바로 아래 팀원에게만 맡길 수 있어요');
    if (!delegable.includes(kind))
      throw new RuleViolation(`맡길 수 있는 일은 ${delegable.join(' · ')}예요: ${kind}`);
    if (!needs.every((scope) => worker.scopes.includes(scope)))
      throw new RuleViolation(`${worker.name}의 권한으로는 할 수 없는 일이에요: ${kind}`);
    const reader = DelegationPolicy.NOT_WITH_BROWSE.some((s) => manager.scopes.includes(s));
    if (!needs.includes(Actor.BROWSE)) return;
    if (reader)
      throw new RuleViolation(
        '전체 읽기 · 초안 작성 권한이 있는 에이전트는 브라우저 일을 맡기지 못해요 (관리자가 브라우저 메뉴에서 맡겨요)',
      );
    if (tainted)
      throw new RuleViolation(
        '비공개를 읽은 대화에서는 브라우저 일을 맡기지 못해요 (새 대화에서 맡겨요)',
      );
  }

  /**
   * 이번에 count개를 맡길 수 있는가 (위 작업이 살아 있는 임대로 일하는 중인지는 Task가 본다).
   * 한 번에 DELEGATE_AT_ONCE개, 작업 하나에 SUBTASKS_MAX개(made는 이미 맡긴 수), 깊이 DEPTH_MAX, 라운드 ROUNDS_MAX까지
   */
  static assertLimits(
    parent: Pick<TaskRow, 'depth' | 'rounds'>,
    count: number,
    made: number,
  ): void {
    const P = DelegationPolicy;
    if (count < 1 || count > P.DELEGATE_AT_ONCE)
      throw new RuleViolation(`한 번에 1~${P.DELEGATE_AT_ONCE}개를 맡길 수 있어요 (한도)`);
    if (made + count > P.SUBTASKS_MAX)
      throw new RuleViolation(
        `작업 하나가 맡길 수 있는 하위 작업은 ${P.SUBTASKS_MAX}개예요 (한도, 이미 ${made}개)`,
      );
    if (parent.depth + 1 > P.DEPTH_MAX)
      throw new RuleViolation(`위임은 ${P.DEPTH_MAX}단계까지예요 (한도)`);
    if (parent.rounds + 1 > P.ROUNDS_MAX)
      throw new RuleViolation(`작업 하나가 위임할 수 있는 횟수는 ${P.ROUNDS_MAX}번이에요 (한도)`);
  }

  /** 이 작업이 아직 위임할 수 있는 횟수 (러너가 일과 함께 받는다) */
  static roundsLeft(parent: Pick<TaskRow, 'rounds'>): number {
    return Math.max(0, DelegationPolicy.ROUNDS_MAX - parent.rounds);
  }

  /**
   * 하위 작업 하나의 칸. 받는 쪽은 manager의 바로 아래 팀원이어야 하고, 그 에이전트의 권한으로 할 수 있는 종류여야 한다 (assert).
   * 하위 작업은 위 작업의 목표와 우선순위를 물려받고, 담당은 worker로 정해진다.
   * code는 code 작업에서만 맡긴다: 위 작업의 저장소 · 명령을 물려받고 경로(paths)는 위 작업의 경로 안으로 좁힌다 (CodeScope).
   * 참조(refs)는 위 작업의 참조 가운데 고른 것만 넘긴다 (TaskRefs.handOn). tainted: 이 일의 대화가 비공개를 읽었다 (브라우저 일 막기)
   */
  static subtask(
    parent: TaskRow,
    parentScope: CodeScope | null,
    manager: Agent,
    worker: Agent | null,
    order: SubtaskOrder,
    tainted: boolean,
  ): Omit<TaskNew, 'id' | 'space_id'> {
    const { fields, paths, refs } = order;
    const { kind } = fields;
    const needs = TaskKinds.SCOPES[kind] ?? [];
    DelegationPolicy.assert(manager, worker, kind, TaskKinds.DELEGABLE, needs, tainted);
    // 모델 상한: 맡기는 일이 쓰는 모델(대화가 정한 것 → 맡기는 에이전트의 설정) 이하에서 (ModelTier)
    const model = ModelTier.forSubtask(
      DelegationPolicy.modelOf(parent) || manager.model,
      order.model,
      worker,
    );
    return {
      ...fields,
      agent_id: worker.id,
      payload: {
        delegatedBy: parent.id,
        ...CodeScope.forSubtask(kind, paths, parentScope),
        ...TaskRefs.of(parent.payload).handOn(refs, worker).payload,
        ...(order.deliver ? { deliver: order.deliver } : {}),
        // 앱 코드를 고치는 make 일 (스토어 1-6b): 어느 앱인지만 물려준다. make 일이 아니면 MakeOrder가 막는다
        ...(order.appId ? { appCode: { appId: order.appId } } : {}),
        // 고른 모델 · 낮춘 모델: JobView가 팀원의 설정 대신 보내고, 이 일이 다시 맡기면 그 상한이 된다
        ...(model ? { runtime: { model } } : {}),
      },
      priority: parent.priority,
      goal_id: parent.goal_id,
      parent_id: parent.id,
      depth: parent.depth + 1,
    };
  }

  /** 일에 실린 모델 (payload.runtime.model: 대화의 회차 · 모델을 정해 맡긴 하위 작업). 없으면 빈 글 */
  private static modelOf(task: TaskRow): string {
    const runtime = (task.payload as { runtime?: { model?: unknown } } | null)?.runtime;
    return typeof runtime?.model === 'string' ? runtime.model : '';
  }
}
