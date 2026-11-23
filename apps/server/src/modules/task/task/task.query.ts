import { Injectable } from '@nestjs/common';
import {
  Actor,
  AgentActor,
  BaseQuery,
  Forbidden,
  LeasedWork,
  NotFound,
  RuleViolation,
  RunRecordTarget,
} from '../../platform';
import { taskRuns, tasks } from '../task.schema';
import type { GoalRow, OutputRow, TaskEventRow, TaskRow, TaskRunRow } from '../task.tables';
import { RunLineage } from './run-lineage.policy';
import { SubtaskWait } from './subtask-wait.policy';
import { Task } from './task';
import type { ListTasksInput, TaskIdInput } from './task.input';
import {
  TaskDetailView,
  TaskEventView,
  TaskGoalView,
  TaskOutputView,
  TaskPageView,
  TaskRunView,
  TaskView,
} from './task.view';

/** 실행 기록의 자리: 맨 위 작업의 줄에 대화 · 목표 실행의 제목과 일한 에이전트를 더한 모양 */
type RecordRootRow = TaskRow & {
  chat_title: string | null;
  run_title: string | null;
  agent_name: string | null;
  agent_tool: string | null;
};

// 작업 읽기. 목록과 상세는 주인만. mcp 모듈은 작업 토큰이 아직 살아 있는지 여기에 묻는다.
@Injectable()
export class TaskQuery extends BaseQuery {
  private static readonly PAGE = 30;
  /** 상세 화면에 보내는 실행 기록. 최근 것부터 이만큼 */
  private static readonly EVENTS = 500;
  /** 목록 카드에 보이는 마지막 기록의 길이 */
  private static readonly LAST_EVENT = 200;
  /** 깨어난 팀장에게 보이는 하위 작업의 최근 진행 기록 (줄 수 · 한 줄 길이, 2026-11-20) */
  private static readonly PROGRESS_LINES = 3;
  private static readonly PROGRESS_TEXT = 300;

  /** 진행 중 작업의 임대가 가장 먼저 끝나는 때. 없으면 null (일꾼의 LeaseJob이 그때 깬다) */
  async nextLeaseEnd(actor: Actor): Promise<Date | null> {
    actor.assertOwnerOrSystem();
    const [row] = await this.sql<Pick<TaskRow, 'lease_until'>[]>`
      SELECT min(lease_until) AS lease_until FROM task.tasks WHERE status = ${Task.RUNNING}`;
    return row?.lease_until ?? null;
  }

  /** 기다리는 기한이 지난 위 작업 (팀원 기다리기, 마감 작업이 하나씩 잠가 깨운다) */
  async overdueWaits(actor: Actor, now: Date): Promise<readonly string[]> {
    actor.assertOwnerOrSystem();
    const rows = await this.sql<Pick<TaskRow, 'id'>[]>`
      SELECT id FROM task.tasks
      WHERE wait_until <= ${now} AND status = ${Task.WAITING} AND wait_reason = ${Task.WAIT_SUBTASKS}
      ORDER BY wait_until LIMIT 50`;
    return rows.map((r) => r.id);
  }

  /** 가장 이른 기다리는 기한. 없으면 null (작업이 바뀌는 신호로 다시 잰다) */
  async nextWaitEnd(actor: Actor): Promise<Date | null> {
    actor.assertOwnerOrSystem();
    const [row] = await this.sql<Pick<TaskRow, 'wait_until'>[]>`
      SELECT min(wait_until) AS wait_until FROM task.tasks WHERE wait_until IS NOT NULL`;
    return row?.wait_until ?? null;
  }

  async list(actor: Actor, req: ListTasksInput): Promise<TaskPageView> {
    actor.assertOwner();
    const rows = await this.sql<(TaskRow & { last_event: string | null })[]>`
      SELECT t.*, e.body AS last_event FROM task.tasks t
      LEFT JOIN LATERAL (
        SELECT left(body, ${TaskQuery.LAST_EVENT}) AS body FROM task.task_events
        WHERE task_id = t.id AND body <> '' ORDER BY id DESC LIMIT 1
      ) e ON true
      WHERE t.space_id = ${actor.spaceId}
        AND t.deleted_at IS ${req.trash ? this.sql`NOT NULL` : this.sql`NULL`}
        ${req.status === null ? this.sql`` : this.sql`AND t.status = ${req.status}`}
        ${req.goalId === null ? this.sql`` : this.sql`AND t.goal_id = ${req.goalId}`}
        ${req.cursor === null ? this.sql`` : this.sql`AND t.id < ${req.cursor}`}
      ORDER BY t.id DESC
      LIMIT ${TaskQuery.PAGE + 1}`;
    const { items, next } = this.pageOf(rows, TaskQuery.PAGE, (last) => last.id);
    return new TaskPageView(
      items.map((r) => new TaskView(r, r.last_event)),
      next,
    );
  }

  async get(actor: Actor, req: TaskIdInput): Promise<TaskDetailView> {
    actor.assertOwner();
    const row = await this.row(tasks, { space_id: actor.requireSpace(), id: req.id });
    if (!row) throw new NotFound('작업을 찾을 수 없어요');
    const events = await this.sql<TaskEventRow[]>`
      SELECT * FROM (
        SELECT * FROM task.task_events WHERE task_id = ${req.id} ORDER BY id DESC LIMIT ${TaskQuery.EVENTS}
      ) e ORDER BY id`;
    const goals = row.goal_id === null ? [] : await this.goalChain(row.goal_id);
    const children = await this.rows(tasks, { parent_id: req.id }, { order: ['id'] });
    const runs = await this.rows(taskRuns, { task_id: req.id }, { order: ['seq'] });
    const made = await this.sql<(OutputRow & { run_seq: number })[]>`
      SELECT o.*, r.seq AS run_seq FROM task.outputs o JOIN task.task_runs r ON r.id = o.run_id
      WHERE o.task_id = ${req.id} AND o.deleted_at IS NULL ORDER BY o.id`;
    return new TaskDetailView(
      row,
      Task.shownPayload(row.kind, row.payload),
      events.map((e) => new TaskEventView(e)),
      goals,
      children.map((c) => new TaskView(c)),
      runs.map((r) => new TaskRunView(r)),
      made.map((o) => new TaskOutputView(o, o.run_seq)),
    );
  }

  /**
   * 이 러너가 지금 임대를 쥐고 도는 작업의 이번 실행 (결과물 올리기 표를 줄 때, output 묶음이 묻는다).
   * 진행 중이 아니거나 · 다른 러너의 것이거나 · 임대가 끝났으면 RuleViolation. 잠그지 않고 읽는다:
   * 표는 허락일 뿐이고, 그사이 취소돼도 받은 파일이 취소된 작업의 결과물로 남을 뿐이다
   */
  async heldRun(actor: Actor, taskId: string): Promise<TaskRunRow> {
    await this.heldTask(actor, taskId);
    return this.runOf(actor, taskId);
  }

  /**
   * 재료 결과물을 받을 실행 (begin_download): 임대를 쥔 이번 실행이고, 그 결과물이 이 만들기 작업의 재료여야 한다.
   * 재료가 아니면 Forbidden. heldRun처럼 잠그지 않고 읽는다
   */
  async heldMaterial(actor: Actor, taskId: string, outputId: string): Promise<TaskRunRow> {
    const task = await this.heldTask(actor, taskId);
    // 대화 · 위임으로 넣은 참조 결과물은 어느 일이든 받는다 (2026-11-15 B). 아니면 만들기 작업의 재료만
    if (!task.refs.outputs.includes(outputId)) {
      const materials = task.makeMaterials;
      if (materials === null)
        throw new RuleViolation('만들기 작업의 재료도, 참조도 아닌 결과물이에요');
      materials.assertOutput(outputId);
    }
    return this.runOf(actor, taskId);
  }

  /**
   * 기능 패키지가 묻는 임대 확인 (platform의 Leases에 등록한다): 이 러너가 지금 쥔 작업의 id · 종류 · 입력 · 대상 · 지시.
   * 진행 중이 아니거나 · 다른 러너의 것이거나 · 임대가 끝났으면 RuleViolation. 입력은 상세와 같이 보인 모양만
   */
  async leasedWork(actor: Actor, taskId: string): Promise<LeasedWork> {
    actor.assertCan(Actor.RUN);
    if (!actor.id || !actor.spaceId) throw new Forbidden(Actor.RUN);
    const row = await this.row(tasks, { space_id: actor.spaceId, id: taskId });
    if (!row) throw new NotFound('작업을 찾을 수 없어요');
    Task.restore(row).assertHeldBy(actor.id, new Date());
    const payload = Task.shownPayload(row.kind, row.payload);
    return new LeasedWork(
      row.id,
      row.kind,
      payload,
      row.target_kind,
      row.target_id,
      row.base_version,
      row.instruction,
      await this.ownerText(actor, row.id),
    );
  }

  /**
   * 관리자가 쓴 지시: 위임된 일이면 맨 위 일(관리자가 맡긴 일)의 제목과 지시. 하위 일의 지시는 AI가 썼다.
   * 맨 위 일이 목표 실행의 회차 작업이면 실행의 지시: 회차 작업의 지시에는 앞 회차의 보고(AI가 쓴 글)가 실린다.
   * 맨 위 일이 기기(MCP ask_agent)가 보낸 대화의 회차면 비어 있다: 관리자가 아니라 그 기기의 AI가 쓴 글일 수 있다.
   * read_url의 기준(WebQuery)과 기능 패키지의 믿는 주소(LeasedWork.ownerText, browser-tabs의 로그인 카드)가 쓴다
   */
  async ownerText(actor: Actor, taskId: string): Promise<string> {
    if (!actor.spaceId) throw new Forbidden(Actor.RUN);
    const spaceId = actor.spaceId;
    const [root] = await this.sql<{ text: string }[]>`
      WITH RECURSIVE up AS (
        SELECT id, parent_id, title, instruction, payload, 0 AS step FROM task.tasks
        WHERE space_id = ${spaceId} AND id = ${taskId}
        UNION ALL
        SELECT t.id, t.parent_id, t.title, t.instruction, t.payload, up.step + 1 FROM task.tasks t
        JOIN up ON t.id = up.parent_id AND t.space_id = ${spaceId}
        WHERE up.step < 10
      )
      SELECT CASE WHEN up.payload -> 'chat' ->> 'via' = 'device' THEN ''
                  WHEN r.id IS NULL THEN up.title || E'\n' || up.instruction
                  ELSE r.title || E'\n' || r.instruction END AS text
      FROM up
      LEFT JOIN task.goal_runs r
        ON r.space_id = ${spaceId} AND r.id::text = up.payload -> 'goalRun' ->> 'runId'
      WHERE up.parent_id IS NULL ORDER BY up.step DESC LIMIT 1`;
    return root?.text ?? '';
  }

  /**
   * 실행의 기록이 들어갈 자리 (platform Leases.registerRecord에 등록, vault가 원문 · 인수인계 메모를 쌓을 때 묻는다, 2026-11-17).
   * 그 러너가 잡았고 진행 중이거나 기다리는 중이며 점유 시간이 남은 작업의, 그 러너의 마지막 실행. 기록하지 않는 일은 RuleViolation.
   * 작업 세션은 맨 위 작업의 대화 · 목표 실행 · 그 작업이고, 제목은 대화 · 목표 실행 · 맨 위 작업의 제목
   */
  async recordTarget(actor: Actor, taskId: string): Promise<RunRecordTarget> {
    actor.assertCan(Actor.RUN);
    if (!actor.id || !actor.spaceId) throw new Forbidden(Actor.RUN);
    const task = await this.row(tasks, { space_id: actor.spaceId, id: taskId });
    if (!task) throw new NotFound('작업을 찾을 수 없어요');
    RunLineage.assertRecordable(task, actor.id, new Date());
    const run = await this.runOf(actor, taskId);
    if (run.lineage === null) throw new RuleViolation('작업 세션에 기록하지 않는 일이에요');
    const [root] = await this.sql<RecordRootRow[]>`
      WITH RECURSIVE up AS (
        SELECT id, parent_id, 0 AS step FROM task.tasks WHERE id = ${taskId}
        UNION ALL
        SELECT t.id, t.parent_id, up.step + 1 FROM task.tasks t JOIN up ON t.id = up.parent_id
        WHERE up.step < 10
      )
      SELECT root.*, c.title AS chat_title, g.title AS run_title,
        a.name AS agent_name, a.tool AS agent_tool
      FROM (SELECT id FROM up ORDER BY step DESC LIMIT 1) top
      JOIN task.tasks root ON root.id = top.id
      LEFT JOIN task.chats c
        ON c.space_id = root.space_id AND c.id::text = root.payload->'chat'->>'chatId'
      LEFT JOIN task.goal_runs g
        ON g.space_id = root.space_id AND root.request_id LIKE 'goal-run:' || g.id || ':%'
      LEFT JOIN task.agents a ON a.id = ${run.agent_id}`;
    if (!root) throw new NotFound('작업을 찾을 수 없어요');
    return new RunRecordTarget(
      task.id,
      run.seq,
      run.lineage,
      RunLineage.flowOf(root),
      root.chat_title ?? root.run_title ?? root.title,
      task.title,
      run.agent_id,
      root.agent_name ?? '에이전트',
      root.agent_tool ?? '',
    );
  }

  /** 이 러너가 임대를 쥔 작업. 진행 중이 아니거나 · 다른 러너의 것이거나 · 임대가 끝났으면 RuleViolation */
  private async heldTask(actor: Actor, taskId: string): Promise<Task> {
    actor.assertCan(Actor.RUN);
    if (!actor.id || !actor.spaceId) throw new Forbidden(Actor.RUN);
    const row = await this.row(tasks, { space_id: actor.spaceId, id: taskId });
    if (!row) throw new NotFound('작업을 찾을 수 없어요');
    const task = Task.restore(row);
    task.assertHeldBy(actor.id, new Date());
    return task;
  }

  /** 이 러너의 마지막 실행 (heldTask 뒤에 부른다) */
  private async runOf(actor: Actor, taskId: string): Promise<TaskRunRow> {
    const run = await this.row(
      taskRuns,
      { task_id: taskId, runner_id: actor.id ?? '' },
      { order: ['seq desc'], limit: 1 },
    );
    if (!run) throw new RuleViolation('이 러너의 실행 기록이 없는 작업이에요');
    return run;
  }

  /** 회사 목표부터 이 목표까지. 목표의 부모는 바뀌지 않는다 */
  private async goalChain(goalId: string): Promise<readonly TaskGoalView[]> {
    const rows = await this.sql<Pick<GoalRow, 'id' | 'title' | 'status'>[]>`
      WITH RECURSIVE up AS (
        SELECT id, parent_id, title, status, 0 AS step FROM task.goals WHERE id = ${goalId}
        UNION ALL
        SELECT g.id, g.parent_id, g.title, g.status, up.step + 1 FROM task.goals g
        JOIN up ON g.id = up.parent_id
      )
      SELECT * FROM up ORDER BY step DESC`;
    return rows.map((r) => new TaskGoalView(r));
  }

  /**
   * 하위 작업마다 최근 진행 기록 (팀원 기다리기, 2026-11-20): 마지막 PROGRESS_LINES줄과 도움 요청 줄(SubtaskWait.HELP_PREFIX) 전부,
   * 오래된 것부터. 깨어난 팀장이 끝나지 않은 일이 어디까지 됐는지 보고 나눠 맡기고, ask_help가 도움 요청 수를 센다
   */
  async progressOf(
    actor: Actor,
    taskIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    const spaceId = actor.requireSpace();
    const lines = new Map<string, string[]>();
    if (taskIds.length === 0) return lines;
    const rows = await this.sql<{ task_id: string; body: string }[]>`
      SELECT task_id, left(body, ${TaskQuery.PROGRESS_TEXT}) AS body FROM (
        SELECT e.task_id, e.body, e.id, row_number() OVER (PARTITION BY e.task_id ORDER BY e.id DESC) AS n
        FROM task.task_events e JOIN task.tasks t ON t.id = e.task_id
        WHERE t.space_id = ${spaceId} AND e.task_id = ANY(${taskIds as string[]}::uuid[]) AND e.body <> ''
      ) recent
      WHERE n <= ${TaskQuery.PROGRESS_LINES} OR body LIKE ${`${SubtaskWait.HELP_PREFIX}%`}
      ORDER BY task_id, id`;
    for (const r of rows) lines.set(r.task_id, [...(lines.get(r.task_id) ?? []), r.body]);
    return lines;
  }

  /**
   * 이 작업 토큰이 아직 쓸 수 있는가. 작업이 진행 중이거나 결재를 기다리고, 임대가 살아 있어야 한다.
   * 결재를 기다리는 동안은 임대가 남은 만큼만 (응답을 놓친 request_approval을 다시 보낼 수 있게).
   */
  async isLive(actor: Actor): Promise<boolean> {
    if (!(actor instanceof AgentActor)) return false;
    const [row] = await this.sql`
      SELECT 1 FROM task.tasks
      WHERE id = ${actor.taskId} AND agent_id = ${actor.agentId}
        AND status IN (${Task.RUNNING}, ${Task.WAITING}) AND lease_until > now()`;
    return row !== undefined;
  }
}
