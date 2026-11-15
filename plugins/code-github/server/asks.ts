import {
  Actor,
  Command,
  DomainEvent,
  NotFound,
  Operation,
  Read,
  Rule,
  RuleViolation,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { checkPaths, codeTaskRequested, PATH_MAX, PATHS_MAX, repoOf } from './code-task';
import { repos, taskAsks } from './schema';
import type { TaskAskRow } from './tables';
import { AgentRepoListView, ConfirmedView, TaskAskedView, TaskAskView } from './views';

// 코드 작업 열기 (2026-11-15 C, 기획서 결정): 대화의 에이전트가 코드 작업을 요청하고, 관리자가 승인하면 연다.
//   에이전트(작업 토큰): code_repos(저장소 목록) → code_ask_task(요청 한 줄) → 코어의 request_approval(code.task.start, 대상 code_github_ask)
//   승인되면 StartAsked가 관리자가 코드 메뉴에서 맡길 때와 같은 코드 작업을 연다 (codeTaskRequested). 반려 · 수정 요청 · 취소면 DropAsked
// 대화 상대(관리자 바로 아래)는 code.task.start를 승인 동작에 넣지 않아도 올린다 (코어 Approval.PARTNER_ACTIONS). 열린 일의 PR은 지금처럼 code.pr.merge로

/** 이 패키지의 결재 동작: 코드 작업 열기 */
export const START_ACTION = 'code.task.start';
/** 결재 대상의 종류 (target_kind) */
export const ASK_TARGET = 'code_github_ask';
const ASKED = 'asked';
const VERSION_MAX = 2_147_483_647;

/** code_repos (작업 토큰): 코드 작업을 요청할 수 있는 저장소 (보관한 것은 빼고) */
export class ListAgentRepos extends Read<null> {
  readonly name = 'agentRepos';
  readonly allow = Actor.AGENT;

  input(): null {
    return null;
  }

  async run(work: Work, actor: Actor): Promise<AgentRepoListView> {
    const rows = await work.rows(
      repos,
      { space_id: actor.requireSpace(), archived_at: null },
      { order: ['name'] },
    );
    return new AgentRepoListView(rows);
  }
}

type AskInput = {
  requestId: string;
  repoId: string;
  paths: readonly string[];
  instruction: string;
  agentId: string | null;
};

/** code_ask_task (작업 토큰): 코드 작업 요청 한 줄. 같은 에이전트의 같은 request_id는 처음 줄 */
export class AskTask extends Command<AskInput> {
  readonly name = 'askTask';
  readonly allow = Actor.AGENT;

  input(raw: unknown): AskInput {
    const agent = (raw as { agent_id?: unknown } | null)?.agent_id;
    return this.fields(raw, (f) => ({
      requestId: f.text('request_id', 100),
      repoId: f.uuid('repo_id'),
      paths: f.optionalTextList('paths', PATHS_MAX, PATH_MAX) ?? [],
      instruction: f.text('instruction', 20_000),
      agentId: agent === undefined || agent === null ? null : f.uuid('agent_id'),
    }));
  }

  async run(work: Work, actor: Actor, input: AskInput): Promise<TaskAskedView> {
    const space = actor.requireSpace();
    const askedBy = actor.id;
    if (!askedBy) throw new RuleViolation('에이전트의 일에서만 요청해요');
    const once = { space_id: space, asked_by: askedBy, request_id: input.requestId };
    const before = await work.row(taskAsks, once);
    if (before) return new TaskAskedView(before);
    const repo = await repoOf(work, space, input.repoId);
    if (repo.archived_at) throw new RuleViolation('보관한 저장소에는 일을 맡길 수 없어요');
    await work.insertRows(taskAsks, {
      ...once,
      repo_id: repo.id,
      paths: [...checkPaths(input.paths)],
      instruction: input.instruction,
      agent_id: input.agentId,
    });
    return new TaskAskedView((await work.row(taskAsks, once)) as TaskAskRow);
  }
}

/** GET /api/p/code-github/asks/:id: 코드 작업 요청 하나 (주인. 승인 화면 · 결과 카드가 code.task.start의 대상을 보일 때) */
export class GetAsk extends Read<{ id: string }> {
  readonly name = 'ask';
  readonly allow = Operation.OWNER;

  input(raw: unknown): { id: string } {
    return this.fields(raw, (f) => ({ id: f.uuid('id') }));
  }

  async run(work: Work, actor: Actor, input: { id: string }): Promise<TaskAskView> {
    const space = actor.requireSpace();
    const row = await work.row(taskAsks, { id: input.id, space_id: space });
    if (!row) throw new NotFound('없는 코드 작업 요청이에요');
    return new TaskAskView(row, await repoOf(work, space, row.repo_id));
  }
}

type DecidedInput = {
  approvalId: string;
  action: string;
  spaceId: string;
  targetId: string | null;
  targetVersion: number | null;
};

/** 결재가 정해진 이벤트 (task.approval.*)의 칸: 코드 작업 열기의 승인 · 반려를 받는 두 동작이 함께 읽는다 */
abstract class AskDecision extends Command<DecidedInput> {
  readonly allow = Operation.SYSTEM;

  input(raw: unknown): DecidedInput {
    const r = (raw ?? {}) as { targetId?: unknown; targetVersion?: unknown };
    return this.fields(raw, (f) => ({
      approvalId: f.uuid('approvalId'),
      action: f.text('action', 100),
      spaceId: f.uuid('spaceId'),
      targetId: typeof r.targetId === 'string' ? f.uuid('targetId') : null,
      targetVersion:
        typeof r.targetVersion === 'number' ? f.integer('targetVersion', 0, VERSION_MAX) : null,
    }));
  }
}

/**
 * code.task.start가 승인되면 (task.approval.granted): 요청한 판 · 상태 · 저장소를 보고 코드 작업을 연다.
 * 결과(plugin.code_github.task_started: approvalId · outcome)는 코어의 ApprovalResultHandler가 받아 요청한 작업을 끝낸다.
 * 같은 결재가 두 번 와도 작업은 하나 (requestId code-github:ask:<요청>), 결과도 같다
 */
export class StartAsked extends AskDecision {
  readonly name = 'startAsked';

  async run(work: Work, _actor: Actor, input: DecidedInput): Promise<ConfirmedView> {
    if (input.action !== START_ACTION) return new ConfirmedView(false);
    const ask = input.targetId
      ? await work.row(taskAsks, { id: input.targetId, space_id: input.spaceId })
      : null;
    const repo = ask ? await work.row(repos, { id: ask.repo_id, space_id: input.spaceId }) : null;
    const again = ask?.approval_id === input.approvalId;
    const problem = !ask
      ? '승인 요청의 코드 작업 요청을 찾을 수 없어요'
      : again
        ? null
        : ask.version !== input.targetVersion
          ? '승인한 뒤 요청이 바뀌었어요'
          : ask.status !== ASKED
            ? '이미 시작했거나 닫은 요청이에요'
            : !repo || repo.archived_at
              ? '보관한 저장소예요'
              : null;
    if (ask && repo && !problem) {
      const requestId = `code-github:ask:${ask.id}`;
      work.record(
        codeTaskRequested(input.spaceId, repo, requestId, ask.instruction, ask.paths, ask.agent_id),
      );
      await work.updateRows(
        taskAsks,
        { status: 'started', approval_id: input.approvalId, updated_at: Rule.now },
        { id: ask.id },
      );
    }
    work.record(
      new DomainEvent('plugin.code_github.task_started', 1, input.spaceId, {
        approvalId: input.approvalId,
        outcome: problem ? 'failed' : 'done',
        ...(problem ? { error: problem } : {}),
      }),
    );
    return new ConfirmedView(true);
  }
}

/** code.task.start가 반려 · 수정 요청 · 취소되면 요청을 닫는다 (에이전트는 고쳐서 새로 요청한다) */
export class DropAsked extends AskDecision {
  readonly name = 'dropAsked';

  async run(work: Work, _actor: Actor, input: DecidedInput): Promise<ConfirmedView> {
    if (input.action !== START_ACTION || !input.targetId) return new ConfirmedView(false);
    await work.updateRows(
      taskAsks,
      { status: 'dropped', updated_at: Rule.now },
      { id: input.targetId, space_id: input.spaceId, status: ASKED },
    );
    return new ConfirmedView(true);
  }
}
