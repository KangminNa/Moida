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
import { RunView, SiteToolsView } from './integration-views';
import { RUN_TARGET, WRITE_ACTION } from './job';
import { integrationRevisions, integrations, runs, sites } from './schema';
import { Shape } from './shape';
import type { IntegrationRevisionRow, IntegrationRow, RunRow } from './tables';

// 사이트 도구의 에이전트 쪽 (2026-11-16 MCP 2 · 3단계). 에이전트가 site_run으로 맡기면 대기열에 쌓이고, 서버 러너가 꺼내
// AI 없이 돌린다 (run-queue.ts). 에이전트는 site_result로 기다려 받는다. 입력이 바깥 사이트로 나가므로 비공개를 읽거나
// 쓰는 에이전트에게는 보이지 않는다 (Actor.AGENT_OUT). 쓰기 도구는 맡기면 결재를 기다리고(held), 에이전트가 답의 결재
// (browser.integration.write, 대상 browser_run)를 올려 승인되면 한 번 돈다 (write-runs.ts)

const QUEUE_MAX = 20;
const WAIT_MAX = 20;
const INPUT_MAX = 16_000;
const KEEP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 기다림이 끝난 상태 (site_result가 더 기다리지 않는다) */
const SETTLED = ['held', 'done', 'failed', 'dropped', 'unknown'];

const STATUS_WORDS: Readonly<Record<string, string>> = {
  building: '굳히는 중인 도구예요',
  reviewing: '검토 중인 도구예요',
  review: '아직 켜지 않은 도구예요',
  broken: '연속으로 실패해 멈춘 도구예요',
  off: '꺼진 도구예요',
};

/** 켜진 도구의 지금 버전 */
export async function liveOf(
  work: Work,
  row: Readonly<IntegrationRow>,
): Promise<IntegrationRevisionRow | null> {
  if (row.live_seq === null) return null;
  return work.row(integrationRevisions, { integration_id: row.id, seq: row.live_seq });
}

/** 결재를 기다리는 쓰기 실행이면 올릴 결재의 모양 */
function approvalOf(row: Readonly<RunRow>) {
  return row.status === 'held'
    ? {
        action: WRITE_ACTION,
        target_kind: RUN_TARGET,
        target_id: row.id,
        target_version: row.version,
      }
    : null;
}

/** MCP site_tools: 켜진 사이트 도구의 이름 · 설명 · 읽기/쓰기 · 사이트 · 입출력 형식 (바깥으로 보내도 되는 에이전트) */
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
 * 쓰기 도구면 결재를 기다린다(held): 답의 approval로 request_approval을 올린다. 같은 request_id는 한 번만 쌓인다 (에이전트마다)
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
    if (asked) return new RunView(asked, approvalOf(asked));
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
      WHERE space_id = ${space} AND status IN ('held', 'queued', 'running')`;
    if ((waiting?.n ?? 0) >= QUEUE_MAX)
      throw new RuleViolation(`도구 실행이 ${QUEUE_MAX}개 밀려 있어요. 잠시 뒤 다시 맡겨요`);
    await work.deleteRows(runs, {
      space_id: space,
      status: ['done', 'failed', 'dropped'],
      created_at: Rule.before(new Date(Date.now() - KEEP_DAYS * DAY_MS)),
    });
    await work.insertRows(runs, {
      space_id: space,
      integration_id: row.id,
      seq: revision.seq,
      agent_id: agent,
      request_id: requestId,
      input: input.input,
      status: row.mode === 'write' ? 'held' : 'queued',
    });
    const saved = await work.row(runs, { space_id: space, request_id: requestId });
    if (!saved) throw new NotFound('실행을 맡기지 못했어요');
    return new RunView(saved, approvalOf(saved));
  }
}

/**
 * MCP site_result { run_id, wait_seconds? }: 맡긴 실행의 결과. 끝날 때까지 최대 20초 기다린다 (맡긴 에이전트만).
 * 결재를 기다리는 쓰기 실행(held)은 기다리지 않고 올릴 결재를 다시 준다
 */
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
      if (SETTLED.includes(row.status) || Date.now() >= deadline)
        return new RunView(row, approvalOf(row));
      await sleep(1000);
    }
  }
}
