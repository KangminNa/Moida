import {
  type Actor,
  Command,
  Conflict,
  DomainEvent,
  NotFound,
  Operation,
  Rule,
  RuleViolation,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { RunSavedView } from './integration-views';
import { RUN_TARGET } from './job';
import { integrations, runs } from './schema';

// 쓰기 사이트 도구의 결재 (2026-11-16 MCP 3단계, docs/MCP.md 7장). 에이전트가 site_run으로 맡긴 쓰기 실행은 결재를 기다리고(held),
// 그 결재(browser.integration.write, 대상 browser_run)가 승인되면 대기열로(queued) 가서 러너가 한 번 돌린다. 결과는
// run_done(approvalId · outcome)으로 남겨 코어가 결재를 올린 작업을 끝낸다. 수정 요청 · 반려 · 취소면 dropped.
// 실행 중 러너를 잃으면 다시 하지 않고 unknown: 관리자가 사이트에서 보고 됐는지를 기록한다 (결재된 클릭과 같은 규칙)

/** 결재 뒤 실행의 결과 */
const RUN_DONE = 'plugin.browser_tabs.run_done';

/** 결재로 돈 쓰기 실행의 결과를 남긴다 */
export function runDone(work: Work, space: string, approvalId: string, error: string | null): void {
  work.record(
    new DomainEvent(RUN_DONE, 1, space, {
      approvalId,
      outcome: error === null ? 'done' : 'failed',
      ...(error === null ? {} : { error }),
    }),
  );
}

/**
 * 쓰기 실행 결재의 결정. 승인 → 결재 때의 판 그대로이고 도구가 켜져 있으면 대기열로. 아니면 실패 결과.
 * 수정 요청 · 반려 · 취소 → dropped. 두 번 와도 같다 (이미 이 결재로 다룬 실행은 그대로)
 */
export async function writeDecided(
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
    input.targetKind === RUN_TARGET && input.targetId
      ? await work.row(runs, { id: input.targetId, space_id: input.spaceId })
      : null;
  if (row?.approval_id === input.approvalId) return;
  const pending = row?.status === 'held' && row.version === input.targetVersion;
  if (decision !== 'granted') {
    if (row && pending)
      await work.updateRows(
        runs,
        {
          status: 'dropped',
          approval_id: input.approvalId,
          finished_at: Rule.now,
          version: row.version + 1,
        },
        { id: row.id, version: row.version },
      );
    return;
  }
  const tool = row
    ? await work.row(integrations, { id: row.integration_id, space_id: input.spaceId })
    : null;
  if (!row || !pending || tool?.status !== 'on' || tool.live_seq !== row.seq)
    return runDone(
      work,
      input.spaceId,
      input.approvalId,
      '승인 요청 뒤 실행이나 도구가 바뀌어 돌리지 않았어요',
    );
  await work.updateRows(
    runs,
    { status: 'queued', approval_id: input.approvalId, version: row.version + 1 },
    { id: row.id, version: row.version },
  );
}

/**
 * POST /api/p/browser-tabs/runs/:id/manual { version, done }: 눌렸는지 모르는 쓰기 실행(unknown)을 관리자가 사이트에서 보고
 * 기록한다. 결재의 결과는 이미 남았다 (실패) — 여기서는 실행 기록만 바로잡는다
 */
export class ManualRun extends Command<{ id: string; version: number; done: boolean }> {
  readonly name = 'manualRun';
  readonly allow = Operation.OWNER;

  input(raw: unknown): { id: string; version: number; done: boolean } {
    return this.fields(raw, (f) => ({
      id: f.uuid('id'),
      version: f.version(),
      done: f.boolean('done'),
    }));
  }

  async run(
    work: Work,
    actor: Actor,
    input: { id: string; version: number; done: boolean },
  ): Promise<RunSavedView> {
    const row = await work.row(runs, { id: input.id, space_id: actor.requireSpace() });
    if (!row) throw new NotFound('없는 실행이에요');
    if (row.status !== 'unknown') throw new RuleViolation('눌렸는지 모르는 실행만 기록해요');
    const status = input.done ? 'done' : 'failed';
    const changed = await work.updateRows(
      runs,
      input.done
        ? { status, output: {}, error: '관리자가 됐다고 기록했어요', version: row.version + 1 }
        : { status, error: '관리자가 안 됐다고 기록했어요', version: row.version + 1 },
      { id: row.id, version: input.version },
    );
    if (changed === 0) throw new Conflict('다른 곳에서 먼저 고쳤어요. 새로 불러와 주세요');
    return new RunSavedView(row.id, status);
  }
}
