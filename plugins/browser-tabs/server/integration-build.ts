import {
  Actor,
  Command,
  DomainEvent,
  NotFound,
  Rule,
  RuleViolation,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { BuildPartView, BuildSavedView } from './integration-views';
import { INTEGRATION_TARGET, leasedBrowse } from './job';
import { requestReview } from './reviews';
import { integrationRevisions, integrations, runs } from './schema';
import { Shape } from './shape';
import type { IntegrationRow } from './tables';

// 사이트 도구 굳히기의 끝 (2026-11-16 MCP 2단계). 러너가 AI가 쓴 형식 · 코드 · 시험을 돌린 결과를 site_build_save로 보내면
// 서버가 형식으로 채점해(시험 3~10개, 70% 이상) 새 버전으로 남긴다. 통과하면 켜기를 기다리고(review), 러너가 켜기 결재
// (browser.integration.enable)를 올린다. 결재의 결정은 enableDecided, 굳히기 작업이 실패 · 취소로 끝나면 buildSettled

/** 결재 뒤 실행의 결과 (코어가 approvalId · outcome을 보고 작업을 끝낸다) */
const INTEGRATION_DONE = 'plugin.browser_tabs.integration_done';
const TESTS_MIN = 3;
const TESTS_MAX = 10;
const PASS_RATE = 0.7;
const PREVIEW_MAX = 2000;
const ERRORS_FOR_BUILD = 5;

type TestCase = {
  name: string;
  input: Readonly<Record<string, unknown>>;
  output: Readonly<Record<string, unknown>> | null;
  error: string | null;
  ms: number | null;
};

type SaveBuildInput = {
  taskId: string;
  inputSchema: Readonly<Record<string, unknown>>;
  outputSchema: Readonly<Record<string, unknown>>;
  code: string;
  tests: readonly TestCase[];
};

/** 러너가 쥔 굳히기 작업의 도구 (작업의 대상이 사이트 도구여야 한다) */
async function buildingOf(work: Work, actor: Actor, taskId: string): Promise<IntegrationRow> {
  const job = await leasedBrowse(work, taskId);
  if (job.targetKind !== INTEGRATION_TARGET || !job.targetId)
    throw new RuleViolation('사이트 도구를 굳히는 작업이 아니에요');
  const row = await work.row(integrations, { id: job.targetId, space_id: actor.requireSpace() });
  if (!row) throw new NotFound('없는 사이트 도구예요');
  return row;
}

/** 시험 하나의 채점: 입력 · 답이 형식에 맞고 오류가 없어야 통과 */
function grade(input: SaveBuildInput, test: TestCase, write: boolean) {
  // 쓰기 도구의 시험은 마른 실행(commit 앞에서 멈춤)이라 답이 없다: commit까지 오류 없이 왔는지만 본다
  const answer = write
    ? null
    : test.output === null
      ? '답이 없어요'
      : Shape.valueProblem(input.outputSchema, test.output, '답');
  const problem = Shape.valueProblem(input.inputSchema, test.input, '입력') ?? test.error ?? answer;
  return {
    name: test.name,
    input: test.input,
    ok: problem === null,
    problem,
    ms: test.ms,
    output: test.output === null ? null : JSON.stringify(test.output).slice(0, PREVIEW_MAX),
  };
}

/**
 * MCP site_build_save { task_id, input_schema, output_schema, code, tests: [{ name, input, output?, error?, ms? }] }:
 * 굳힌 결과를 남긴다 (그 작업을 쥔 러너). 형식이 쓰는 부분을 넘거나 시험이 3개 미만이면 거절. 채점해서 새 버전으로 남기고,
 * 70% 이상이면 받아들여 켜기를 기다린다. 답의 integration_version으로 켜기 결재를 올린다.
 * 쓰기 도구는 시험이 마른 실행이라 답을 채점하지 않고, 받아들이면 켜기 결재 대신 검토자에게 맡긴다 (review: true)
 */
export class SaveBuild extends Command<SaveBuildInput> {
  readonly name = 'saveBuild';
  readonly allow = Actor.RUN;

  input(raw: unknown): SaveBuildInput {
    return this.fields(raw, (f) => ({
      taskId: f.uuid('task_id'),
      inputSchema: f.optionalRecord('input_schema'),
      outputSchema: f.optionalRecord('output_schema'),
      code: f.text('code', 32_000),
      tests: f.nestedList('tests', TESTS_MAX).map((t) => {
        const error = t.optionalText('error', 500);
        const output = t.optionalRecord('output');
        return {
          name: t.text('name', 60),
          input: t.optionalRecord('input'),
          output: error === null ? output : null,
          error,
          ms: t.optionalInteger('ms', 0, 600_000),
        };
      }),
    }));
  }

  async run(work: Work, actor: Actor, input: SaveBuildInput): Promise<BuildSavedView> {
    const row = await buildingOf(work, actor, input.taskId);
    if (row.status !== 'building') throw new RuleViolation('굳히는 중인 도구가 아니에요');
    const schemaProblem =
      Shape.schemaProblem(input.inputSchema) ?? Shape.schemaProblem(input.outputSchema);
    if (schemaProblem) throw new RuleViolation(`형식이 쓰는 부분을 넘어요: ${schemaProblem}`);
    if (input.tests.length < TESTS_MIN) throw new RuleViolation(`시험은 ${TESTS_MIN}개부터예요`);
    const tests = input.tests.map((t) => grade(input, t, row.mode === 'write'));
    const passed = tests.filter((t) => t.ok).length;
    const accepted = passed / tests.length >= PASS_RATE;
    const [last] = await work.sql<{ seq: number }[]>`
      SELECT coalesce(max(seq), 0)::int AS seq FROM browser_tabs.integration_revisions
      WHERE integration_id = ${row.id}`;
    const seq = (last?.seq ?? 0) + 1;
    await work.insertRows(integrationRevisions, {
      space_id: row.space_id,
      integration_id: row.id,
      seq,
      input_schema: input.inputSchema,
      output_schema: input.outputSchema,
      code: input.code,
      tests,
      passed,
      total: tests.length,
      build_task_id: input.taskId,
    });
    const [made] = await work.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM browser_tabs.integration_revisions
      WHERE integration_id = ${row.id} AND build_task_id = ${input.taskId}`;
    let version = row.version;
    const review = accepted && row.mode === 'write';
    // 읽기 도구는 시험 · 규칙 검사를 통과하면 승인 없이 바로 켠다 (2026-11-19 사용자 결정: 승인 줄이기, MCP 먼저).
    // 쓰기 도구는 지금처럼 검토자 짝 → 켜기 승인, 부를 때마다 승인
    const enabled = accepted && row.mode !== 'write';
    if (accepted) {
      version = row.version + 1;
      const live = enabled ? { live_seq: seq, fail_streak: 0 } : {};
      const status = review ? 'reviewing' : enabled ? 'on' : 'review';
      await work.updateRows(
        integrations,
        { status, draft_seq: seq, ...live, version, updated_at: Rule.now },
        { id: row.id, version: row.version },
      );
      // 쓰기 도구는 켜기 결재 대신 검토자 짝에게 (검토자가 통과시키면 켜기 결재를 올린다)
      if (review) requestReview(work, { ...row, version }, seq);
    }
    const problems = tests
      .filter((t) => !t.ok)
      .map((t) => ({ name: t.name, problem: String(t.problem) }));
    return new BuildSavedView({
      accepted,
      seq,
      version,
      passed,
      total: tests.length,
      rounds: made?.n ?? 1,
      review,
      enabled,
      problems,
    });
  }
}

/** browser_job의 굳히기 몫: 도구, 마지막 버전, 최근 실패 까닭 (고치기의 힌트). 러너가 굳히기 작업을 쥔 것을 적는다 */
export async function buildPartOf(
  work: Work,
  row: Readonly<IntegrationRow>,
  taskId: string,
): Promise<BuildPartView> {
  if (row.build_task_id !== taskId)
    await work.updateRows(integrations, { build_task_id: taskId }, { id: row.id });
  const last = await work.row(
    integrationRevisions,
    { integration_id: row.id },
    { order: ['seq desc'] },
  );
  const failed = await work.rows(
    runs,
    { integration_id: row.id, status: 'failed' },
    { order: ['id desc'], limit: ERRORS_FOR_BUILD },
  );
  return new BuildPartView(row, last, failed.map((r) => r.error ?? '').filter(Boolean));
}

/** 켜기 결재의 결과를 남긴다 */
function integrationDone(work: Work, space: string, approvalId: string, error: string | null) {
  work.record(
    new DomainEvent(INTEGRATION_DONE, 1, space, {
      approvalId,
      outcome: error === null ? 'done' : 'failed',
      ...(error === null ? {} : { error }),
    }),
  );
}

/**
 * 켜기 결재(browser.integration.enable, 대상 browser_integration)의 결정. 승인 → 결재 때의 판 그대로면 켠다.
 * 수정 요청 → 다시 굳히는 중 (코어가 같은 작업을 대기열로 돌려 메모와 함께 다시 굳힌다). 반려 · 취소 → 끈다. 두 번 와도 같다
 */
export async function enableDecided(
  work: Work,
  decision: 'granted' | 'revised' | 'closed',
  input: {
    approvalId: string;
    spaceId: string;
    targetKind: string | null;
    targetId: string | null;
    targetVersion: number | null;
  },
): Promise<void> {
  const row =
    input.targetKind === INTEGRATION_TARGET && input.targetId
      ? await work.row(integrations, { id: input.targetId, space_id: input.spaceId })
      : null;
  if (decision === 'granted') {
    if (row?.status === 'on' && row.live_seq === row.draft_seq)
      return integrationDone(work, input.spaceId, input.approvalId, null);
    if (row?.status !== 'review' || row.version !== input.targetVersion || !row.draft_seq)
      return integrationDone(
        work,
        input.spaceId,
        input.approvalId,
        '승인 요청 뒤 바뀐 도구라 켜지 않았어요',
      );
    await work.updateRows(
      integrations,
      {
        status: 'on',
        live_seq: row.draft_seq,
        fail_streak: 0,
        version: row.version + 1,
        updated_at: Rule.now,
      },
      { id: row.id, version: row.version },
    );
    return integrationDone(work, input.spaceId, input.approvalId, null);
  }
  if (row?.status !== 'review') return;
  await work.updateRows(
    integrations,
    {
      status: decision === 'revised' ? 'building' : 'off',
      version: row.version + 1,
      updated_at: Rule.now,
    },
    { id: row.id, version: row.version },
  );
}

/** 굳히기 작업이 실패 · 취소로 끝났다: 굳히는 중인 도구를 끈다 (마지막 실패 까닭과 함께) */
export async function buildSettled(work: Work, spaceId: string, taskId: string): Promise<boolean> {
  const row = await work.row(integrations, {
    space_id: spaceId,
    build_task_id: taskId,
    status: 'building',
  });
  if (!row) return false;
  await work.updateRows(
    integrations,
    {
      status: 'off',
      last_error: '굳히지 못했어요 (작업이 실패하거나 멈췄어요)',
      version: row.version + 1,
      updated_at: Rule.now,
    },
    { id: row.id, version: row.version },
  );
  return true;
}
