import {
  Actor,
  Command,
  NotFound,
  Rule,
  ValueList,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { NextRunView, RunSavedView } from './integration-views';
import { requestBuild } from './integrations';
import { integrationRevisions, integrations, runs, sites } from './schema';
import { Shape } from './shape';
import { liveOf } from './site-runs';
import { type IntegrationRow, RUN_ERROR_KIND, type RunErrorKind, type RunRow } from './tables';
import { runDone } from './write-runs';

// 사이트 도구 실행의 러너 쪽 (2026-11-16 MCP 2 · 3단계): 서버 브라우저가 있는 러너가 site_run_next로 하나 꺼내 AI 없이 돌리고
// site_run_save로 남긴다. 읽기 실행은 러너를 잃으면 한 번 다시 줄을 세우고, 쓰기 실행(결재가 있는 것)은 많아야 한 번이라
// 다시 하지 않고 unknown(눌렸는지 모름)으로 둔다. 연속 실패면 고장, 자동 고치기(autoRepair)가 켜져 있으면 하루 한 번 다시 굳힌다

const OUTPUT_MAX = 256 * 1024;
const RUN_TIMEOUT_MS = 60_000;
/** 러너가 꺼낸 뒤 이 시간 안에 남기지 않으면 잃은 것으로 본다 (실행 한도 + 여유) */
const LEASE_MS = 90_000;
const TRIES_MAX = 2;
const BROKEN_AFTER = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 도구 탓이 아닌 실패: 연속 실패에 넣지 않는다 (로그인이 풀림 · 러너가 멈춤 · 도구를 끔) */
const NOT_THE_TOOL = ['login', 'lost', 'off'];
const UNKNOWN =
  '실행하던 러너가 멈춰 눌렸는지 몰라요. 사이트에서 확인하고 사이트 도구 화면에 기록해 주세요';

/** 실행 하나를 끝낸다 (판이 다르면 이미 다른 곳이 끝냈다). 결재로 돈 쓰기 실행이면 결과를 남긴다 */
async function finish(work: Work, row: Readonly<RunRow>, changes: Partial<RunRow>) {
  const changed = await work.updateRows(
    runs,
    { ...changes, finished_at: Rule.now, version: row.version + 1 },
    { id: row.id, version: row.version },
  );
  if (changed > 0 && row.approval_id)
    runDone(
      work,
      row.space_id,
      row.approval_id,
      changes.status === 'done' ? null : String(changes.error),
    );
  return changed > 0;
}

/** 임대가 끝난 실행: 읽기는 한 번 다시 줄, 쓰기는 unknown */
async function recover(work: Work, space: string): Promise<void> {
  const lost = await work.rows(runs, {
    space_id: space,
    status: 'running',
    started_at: Rule.before(new Date(Date.now() - LEASE_MS)),
  });
  for (const row of lost)
    if (row.approval_id) await finish(work, row, { status: 'unknown', error: UNKNOWN });
    else if (row.tries >= TRIES_MAX)
      await finish(work, row, {
        status: 'failed',
        error: '실행하던 러너가 멈췄어요',
        error_kind: 'lost',
      });
    else
      await work.updateRows(
        runs,
        { status: 'queued', runner_id: null, version: row.version + 1 },
        { id: row.id, version: row.version },
      );
}

/**
 * MCP site_run_next: 기다리는 실행 하나를 꺼낸다 (러너, 브라우저가 있는 러너만 부른다). 그사이 도구가 꺼졌으면 그 실행은
 * 실패로 끝내고 다음 부름을 기다린다. 답에 읽기 · 쓰기를 싣는다 (쓰기는 commit에서만 보낸다)
 */
export class NextRun extends Command<null> {
  readonly name = 'nextRun';
  readonly allow = Actor.RUN;

  input(): null {
    return null;
  }

  async run(work: Work, actor: Actor): Promise<NextRunView> {
    const space = actor.requireSpace();
    await recover(work, space);
    const next = await work.row(runs, { space_id: space, status: 'queued' }, { order: ['id'] });
    if (!next) return new NextRunView(null);
    const row = await work.row(integrations, { id: next.integration_id, space_id: space });
    const revision = row?.status === 'on' ? await liveOf(work, row) : null;
    const site = row ? await work.row(sites, { id: row.site_id, space_id: space }) : null;
    if (!row || !revision || !site || revision.seq !== next.seq) {
      await finish(work, next, {
        status: 'failed',
        error: '도구가 꺼졌거나 바뀌었어요',
        error_kind: 'off',
      });
      return new NextRunView(null);
    }
    const took = await work.updateRows(
      runs,
      {
        status: 'running',
        runner_id: actor.id,
        started_at: Rule.now,
        tries: next.tries + 1,
        version: next.version + 1,
      },
      { id: next.id, version: next.version, status: 'queued' },
    );
    if (took === 0) return new NextRunView(null);
    return new NextRunView({
      run: next,
      revision,
      site,
      mode: row.mode,
      timeoutMs: RUN_TIMEOUT_MS,
    });
  }
}

type SaveInput = {
  runId: string;
  status: string;
  output: Readonly<Record<string, unknown>>;
  error: string | null;
  errorKind: RunErrorKind | null;
  ms: number | null;
};

/**
 * MCP site_run_save { run_id, status: done · failed, output?, error?, error_kind?, ms? }: 실행 결과 (꺼낸 러너만).
 * 답은 버전의 출력 형식으로 검사한다 (틀리면 shape 실패). 도구에 집계를 적고, 연속 실패면 고장으로 둔다.
 * 로그인 화면을 만났으면 사이트에 로그인 필요를 적는다 (browse로 맡기면 로그인 결재로 이어진다)
 */
export class SaveRun extends Command<SaveInput> {
  readonly name = 'saveRun';
  readonly allow = Actor.RUN;

  constructor(private readonly autoRepair: boolean) {
    super();
  }

  input(raw: unknown): SaveInput {
    return this.fields(raw, (f) => {
      const status = f.text('status', 10);
      if (status !== 'done' && status !== 'failed') f.reject('status', 'done · failed 중 하나예요');
      const kind = f.optionalText('error_kind', 20);
      if (kind !== null && !ValueList.has(RUN_ERROR_KIND, kind))
        f.reject('error_kind', `${RUN_ERROR_KIND.join(' · ')} 중 하나예요`);
      return {
        runId: f.uuid('run_id'),
        status,
        output: f.optionalRecord('output'),
        error: f.optionalText('error', 500),
        // 틀린 값은 위에서 거절한다
        errorKind: ValueList.has(RUN_ERROR_KIND, kind) ? kind : null,
        ms: f.optionalInteger('ms', 0, 600_000),
      };
    });
  }

  async run(work: Work, actor: Actor, input: SaveInput): Promise<RunSavedView> {
    const space = actor.requireSpace();
    const row = await work.row(runs, { id: input.runId, space_id: space });
    if (row?.status !== 'running' || row.runner_id !== actor.id)
      throw new NotFound('이 러너가 꺼낸 실행이 아니에요 (없거나 이미 끝났어요)');
    const revision = await work.row(integrationRevisions, {
      integration_id: row.integration_id,
      seq: row.seq,
    });
    let result: Partial<RunRow> = {
      status: 'failed',
      error: input.error || '실행하지 못했어요',
      error_kind: input.errorKind ?? 'code',
    };
    if (input.status === 'done') {
      const problem =
        JSON.stringify(input.output).length > OUTPUT_MAX
          ? `답은 ${OUTPUT_MAX / 1024}KB까지예요`
          : Shape.valueProblem(revision?.output_schema, input.output);
      result = problem
        ? {
            status: 'failed',
            error: `답이 형식과 달라요: ${problem}`.slice(0, 500),
            error_kind: 'shape',
          }
        : { status: 'done', output: input.output, error: null, error_kind: null };
    }
    if (!(await finish(work, row, { ...result, ms: input.ms })))
      throw new NotFound('이미 끝난 실행이에요');
    const broken = await noteRun(work, row.integration_id, result);
    if (broken && this.autoRepair) await repair(work, broken);
    if (result.error_kind === 'login') {
      const tool = await work.row(integrations, { id: row.integration_id, space_id: space });
      if (tool) await work.updateRows(sites, { login_needed_at: Rule.now }, { id: tool.site_id });
    }
    return new RunSavedView(row.id, String(result.status));
  }
}

/**
 * 도구의 집계 (판을 올리지 않는다: 관리자의 편집과 부딪히지 않게). 연속 실패가 BROKEN_AFTER에 닿으면 고장으로 두는 것만
 * 판을 올린다 (사람이 보고 고칠 상태라서). 방금 고장이 됐으면 그 도구를 돌려준다
 */
async function noteRun(
  work: Work,
  integrationId: string,
  result: Partial<RunRow>,
): Promise<IntegrationRow | null> {
  if (result.status === 'done') {
    await work.sql`
      UPDATE browser_tabs.integrations
      SET runs_ok = runs_ok + 1, fail_streak = 0, last_run_at = now()
      WHERE id = ${integrationId}`;
    return null;
  }
  const counts = !NOT_THE_TOOL.includes(String(result.error_kind));
  await work.sql`
    UPDATE browser_tabs.integrations
    SET runs_failed = runs_failed + 1,
        fail_streak = fail_streak + ${counts ? 1 : 0},
        last_run_at = now(),
        last_error = ${String(result.error ?? '').slice(0, 500)}
    WHERE id = ${integrationId}`;
  const [broken] = await work.sql<IntegrationRow[]>`
    UPDATE browser_tabs.integrations
    SET status = 'broken', version = version + 1, updated_at = now()
    WHERE id = ${integrationId} AND status = 'on' AND fail_streak >= ${BROKEN_AFTER}
    RETURNING *`;
  return broken ?? null;
}

/**
 * 고장 자동 고치기 (2026-11-16 MCP 3단계): 하루 한 번까지 처음 굳힌 에이전트에게 다시 굳히기를 맡긴다.
 * 앞 버전은 남고, 다음 회차는 최근 실패를 힌트로 받는다. 고친 버전은 늘 켜기 승인(쓰기는 검토 뒤)으로 켠다
 */
async function repair(work: Work, row: Readonly<IntegrationRow>): Promise<void> {
  if (row.repaired_at && Date.now() - row.repaired_at.getTime() < DAY_MS) return;
  const changed = await work.updateRows(
    integrations,
    { status: 'building', repaired_at: Rule.now, version: row.version + 1, updated_at: Rule.now },
    { id: row.id, version: row.version, status: 'broken' },
  );
  if (changed === 0) return;
  const day = new Date().toISOString().slice(0, 10);
  const next: Readonly<IntegrationRow> = { ...row, status: 'building', version: row.version + 1 };
  requestBuild(work, row.space_id, next, `repair:${row.id}:${day}`, row.agent_id);
}
