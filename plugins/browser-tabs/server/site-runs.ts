import { setTimeout as sleep } from 'node:timers/promises';
import {
  Actor,
  Command,
  NotFound,
  Read,
  Rule,
  RuleViolation,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { NextRunView, RunSavedView, RunView, SiteToolsView } from './integration-views';
import { integrationRevisions, integrations, runs, sites } from './schema';
import { Shape } from './shape';
import type { IntegrationRevisionRow, IntegrationRow, RunRow } from './tables';

// 사이트 도구의 실행 (2026-11-16 MCP 2단계). 에이전트가 site_run으로 맡기면 대기열에 쌓이고, 서버 러너(브라우저가 있는 러너)가
// site_run_next로 꺼내 AI 없이 코드를 돌리고 site_run_save로 남긴다. 에이전트는 site_result로 기다려 받는다 (탭 읽기와 같은 길).
// 입력이 바깥 사이트로 나가므로 비공개를 읽거나 쓰는 에이전트에게는 보이지 않는다 (Actor.AGENT_OUT, 커넥터와 같은 규칙).
// 실패하면 답에 대신할 길(browse로 맡기기)을 싣고, 연속 실패(BROKEN_AFTER)면 고장으로 두어 목록에서 뺀다

const QUEUE_MAX = 20;
const WAIT_MAX = 20;
const INPUT_MAX = 16_000;
const OUTPUT_MAX = 256 * 1024;
const RUN_TIMEOUT_MS = 60_000;
/** 러너가 꺼낸 뒤 이 시간 안에 남기지 않으면 잃은 것으로 본다 (실행 한도 + 여유) */
const LEASE_MS = 90_000;
const TRIES_MAX = 2;
const BROKEN_AFTER = 3;
const KEEP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const KINDS = ['login', 'timeout', 'shape', 'code', 'lost', 'off'];
/** 도구 탓이 아닌 실패: 연속 실패에 넣지 않는다 (로그인이 풀림 · 러너가 멈춤 · 도구를 끔) */
const NOT_THE_TOOL = ['login', 'lost', 'off'];

const STATUS_WORDS: Readonly<Record<string, string>> = {
  building: '굳히는 중인 도구예요',
  review: '아직 켜지 않은 도구예요',
  broken: '연속으로 실패해 멈춘 도구예요',
  off: '꺼진 도구예요',
};

/** 켜진 도구의 지금 버전 */
async function liveOf(
  work: Work,
  row: Readonly<IntegrationRow>,
): Promise<IntegrationRevisionRow | null> {
  if (row.live_seq === null) return null;
  return work.row(integrationRevisions, { integration_id: row.id, seq: row.live_seq });
}

/** MCP site_tools: 켜진 사이트 도구의 이름 · 설명 · 사이트 · 입출력 형식 (바깥으로 보내도 되는 에이전트) */
export class SiteTools extends Read<null> {
  readonly name = 'siteTools';
  readonly allow = Actor.AGENT_OUT;

  input(): null {
    return null;
  }

  async run(work: Work, actor: Actor): Promise<SiteToolsView> {
    const space = actor.requireSpace();
    const rows = await work.rows(
      integrations,
      { space_id: space, status: 'on' },
      { order: ['name'] },
    );
    const names = new Map((await work.rows(sites, { space_id: space })).map((s) => [s.id, s.name]));
    const tools = [];
    for (const row of rows) {
      const revision = await liveOf(work, row);
      if (revision) tools.push({ row, revision, site: names.get(row.site_id) ?? '' });
    }
    return new SiteToolsView(tools);
  }
}

type RunInput = { requestId: string; name: string; input: Readonly<Record<string, unknown>> };

/**
 * MCP site_run { request_id, name, input }: 켜진 도구 하나를 맡긴다. 입력을 형식으로 검사하고 대기열에 넣는다.
 * 같은 request_id는 한 번만 쌓인다 (에이전트마다). 결과는 site_result로 기다린다
 */
export class SiteRun extends Command<RunInput> {
  readonly name = 'siteRun';
  readonly allow = Actor.AGENT_OUT;

  input(raw: unknown): RunInput {
    return this.fields(raw, (f) => ({
      requestId: f.text('request_id', 100),
      name: f.text('name', 40),
      input: f.optionalRecord('input'),
    }));
  }

  async run(work: Work, actor: Actor, input: RunInput): Promise<RunView> {
    const space = actor.requireSpace();
    const agent = actor.id ?? '';
    const requestId = `${agent}:${input.requestId}`;
    const asked = await work.row(runs, { space_id: space, request_id: requestId });
    if (asked) return new RunView(asked);
    const row = await work.row(integrations, { space_id: space, name: input.name });
    if (!row) throw new NotFound(`없는 사이트 도구예요: ${input.name} (site_tools로 목록을 봐요)`);
    const revision = row.status === 'on' ? await liveOf(work, row) : null;
    if (!revision)
      throw new RuleViolation(
        `${STATUS_WORDS[row.status] ?? '쓸 수 없는 도구예요'}. ${RunView.FALLBACK}`,
      );
    if (JSON.stringify(input.input).length > INPUT_MAX)
      throw new RuleViolation(`입력은 ${INPUT_MAX}자까지예요`);
    const problem = Shape.valueProblem(revision.input_schema, input.input);
    if (problem) throw new RuleViolation(`입력이 형식과 달라요: ${problem}`);
    const [waiting] = await work.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM browser_tabs.runs
      WHERE space_id = ${space} AND status IN ('queued', 'running')`;
    if ((waiting?.n ?? 0) >= QUEUE_MAX)
      throw new RuleViolation(`도구 실행이 ${QUEUE_MAX}개 밀려 있어요. 잠시 뒤 다시 맡겨요`);
    await work.deleteRows(runs, {
      space_id: space,
      status: ['done', 'failed'],
      created_at: Rule.before(new Date(Date.now() - KEEP_DAYS * DAY_MS)),
    });
    await work.insertRows(runs, {
      space_id: space,
      integration_id: row.id,
      seq: revision.seq,
      agent_id: agent,
      request_id: requestId,
      input: input.input,
    });
    const saved = await work.row(runs, { space_id: space, request_id: requestId });
    if (!saved) throw new NotFound('실행을 맡기지 못했어요');
    return new RunView(saved);
  }
}

/** MCP site_result { run_id, wait_seconds? }: 맡긴 실행의 결과. 끝날 때까지 최대 20초 기다린다 (맡긴 에이전트만) */
export class SiteResult extends Read<{ runId: string; waitSeconds: number }> {
  readonly name = 'siteResult';
  readonly allow = Actor.AGENT_OUT;

  input(raw: unknown): { runId: string; waitSeconds: number } {
    return this.fields(raw, (f) => ({
      runId: f.uuid('run_id'),
      waitSeconds: f.optionalInteger('wait_seconds', 0, WAIT_MAX) ?? WAIT_MAX,
    }));
  }

  async run(
    work: Work,
    actor: Actor,
    input: { runId: string; waitSeconds: number },
  ): Promise<RunView> {
    const where = { id: input.runId, space_id: actor.requireSpace(), agent_id: actor.id ?? '' };
    const deadline = Date.now() + input.waitSeconds * 1000;
    for (;;) {
      const row = await work.row(runs, where);
      if (!row) throw new NotFound('맡긴 실행이 아니에요');
      if (row.status === 'done' || row.status === 'failed' || Date.now() >= deadline)
        return new RunView(row);
      await sleep(1000);
    }
  }
}

/** 실행 하나를 끝낸다 (판이 다르면 이미 다른 곳이 끝냈다) */
async function finish(
  work: Work,
  row: Readonly<RunRow>,
  changes: Partial<RunRow>,
): Promise<boolean> {
  const changed = await work.updateRows(
    runs,
    { ...changes, finished_at: Rule.now, version: row.version + 1 },
    { id: row.id, version: row.version },
  );
  return changed > 0;
}

/**
 * MCP site_run_next: 기다리는 실행 하나를 꺼낸다 (러너, 브라우저가 있는 러너만 부른다). 임대가 끝난 실행은 한 번 다시 줄을 세우고,
 * 또 잃으면 실패. 그사이 도구가 꺼졌으면 그 실행은 실패로 끝내고 다음 부름을 기다린다
 */
export class NextRun extends Command<null> {
  readonly name = 'nextRun';
  readonly allow = Actor.RUN;

  input(): null {
    return null;
  }

  async run(work: Work, actor: Actor): Promise<NextRunView> {
    const space = actor.requireSpace();
    const lost = await work.rows(runs, {
      space_id: space,
      status: 'running',
      started_at: Rule.before(new Date(Date.now() - LEASE_MS)),
    });
    for (const row of lost)
      if (row.tries >= TRIES_MAX)
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
    const next = await work.row(runs, { space_id: space, status: 'queued' }, { order: ['id'] });
    if (!next) return new NextRunView(null);
    const row = await work.row(integrations, { id: next.integration_id, space_id: space });
    const revision = row?.status === 'on' ? await liveOf(work, row) : null;
    const site = row ? await work.row(sites, { id: row.site_id, space_id: space }) : null;
    if (!row || !revision || !site) {
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
    return new NextRunView({ run: next, revision, site, timeoutMs: RUN_TIMEOUT_MS });
  }
}

type SaveInput = {
  runId: string;
  status: string;
  output: Readonly<Record<string, unknown>>;
  error: string | null;
  errorKind: string | null;
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

  input(raw: unknown): SaveInput {
    return this.fields(raw, (f) => {
      const status = f.text('status', 10);
      if (status !== 'done' && status !== 'failed') f.reject('status', 'done · failed 중 하나예요');
      const kind = f.optionalText('error_kind', 20);
      if (kind !== null && !KINDS.includes(kind))
        f.reject('error_kind', `${KINDS.join(' · ')} 중 하나예요`);
      return {
        runId: f.uuid('run_id'),
        status,
        output: f.optionalRecord('output'),
        error: f.optionalText('error', 500),
        errorKind: kind,
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
    await noteRun(work, row.integration_id, result);
    if (result.error_kind === 'login') {
      const tool = await work.row(integrations, { id: row.integration_id, space_id: space });
      if (tool) await work.updateRows(sites, { login_needed_at: Rule.now }, { id: tool.site_id });
    }
    return new RunSavedView(row.id, String(result.status));
  }
}

/**
 * 도구의 집계 (판을 올리지 않는다: 관리자의 편집과 부딪히지 않게). 연속 실패가 BROKEN_AFTER에 닿으면 고장으로 두는 것만
 * 판을 올린다 (사람이 보고 고칠 상태라서)
 */
async function noteRun(work: Work, integrationId: string, result: Partial<RunRow>): Promise<void> {
  if (result.status === 'done') {
    await work.sql`
      UPDATE browser_tabs.integrations
      SET runs_ok = runs_ok + 1, fail_streak = 0, last_run_at = now()
      WHERE id = ${integrationId}`;
    return;
  }
  const counts = !NOT_THE_TOOL.includes(String(result.error_kind));
  await work.sql`
    UPDATE browser_tabs.integrations
    SET runs_failed = runs_failed + 1,
        fail_streak = fail_streak + ${counts ? 1 : 0},
        last_run_at = now(),
        last_error = ${String(result.error ?? '').slice(0, 500)}
    WHERE id = ${integrationId}`;
  await work.sql`
    UPDATE browser_tabs.integrations
    SET status = 'broken', version = version + 1, updated_at = now()
    WHERE id = ${integrationId} AND status = 'on' AND fail_streak >= ${BROKEN_AFTER}`;
}
