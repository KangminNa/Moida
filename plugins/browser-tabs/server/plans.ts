import {
  Actor,
  Command,
  NotFound,
  Rule,
  RuleViolation,
  type Work,
} from '../../../apps/server/src/plugin-api';
import type { Decision } from './approvals';
import { clickDone, pageUrlOf, planContinues, siteOfJob } from './job';
import { PlanHeldView } from './plan-views';
import { clickPlans, clicks } from './schema';
import type { ClickPlanRow, ClickRow } from './tables';

// 일 하나에 승인 한 번 (F2, 2026-11-21). 같은 사이트에서 마지막 버튼을 여러 번 눌러야 하는 일은 AI가 첫 버튼 앞에서
// 계획(무엇을 · 몇 번)을 남기고 멈춘다 → 러너가 계획을 붙잡아(browser_click_plan) 결재를 올린다 (대상 browser_click_plan)
// → 승인되면 같은 작업이 다시 대기열로 간다 (결과 이벤트의 outcome continue) → 다음 실행에서 AI가 버튼마다
// browser_press로 누르기를 요청하면 러너(AI 없음)가 그 버튼을 다시 찾아 누르고(browser_press_next · _save),
// AI는 browser_press_result로 결과를 본다. 누르는 것은 여전히 믿는 코드다 (원칙 7). 횟수와 사이트(허용 출처)는 서버가 지킨다.
//   계획: held → approved → closed(작업이 끝남),  held → dropped(결재가 닫힘)
//   누르기(클릭 줄, plan_id): requested → clicking → clicked · changed,  requested → dropped(실행이 끝남)

/** 계획 하나에 누를 수 있는 수 (DB CHECK와 같다) */
const MAX_CLICKS = 50;

type PlanInput = {
  taskId: string;
  pageUrl: string;
  summary: string;
  count: number;
};

/** MCP browser_click_plan: AI가 남긴 누르기 계획을 붙잡는다 (러너). 받은 plan_id · version으로 결재를 올린다 */
export class HoldPlan extends Command<PlanInput> {
  readonly name = 'holdPlan';
  readonly allow = Actor.RUN;

  input(raw: unknown): PlanInput {
    return this.fields(raw, (f) => ({
      taskId: f.uuid('task_id'),
      pageUrl: pageUrlOf(f, 'page_url'),
      summary: f.text('summary', 300),
      count: f.integer('count', 1, MAX_CLICKS),
    }));
  }

  async run(work: Work, actor: Actor, input: PlanInput): Promise<PlanHeldView> {
    const site = await siteOfJob(work, actor, input.taskId);
    if (!site.origins.includes(new URL(input.pageUrl).origin))
      throw new RuleViolation('허용 출처 밖의 페이지라 계획을 붙잡지 않아요');
    // 결재를 올리지 못하고 끝난 앞 실행의 계획은 닫는다 (작업 하나에 열린 계획은 하나)
    for (const old of await work.rows(clickPlans, { task_id: input.taskId, status: 'held' }))
      await movePlan(work, old, 'dropped');
    await work.insertRows(clickPlans, {
      space_id: actor.requireSpace(),
      task_id: input.taskId,
      site_id: site.id,
      page_url: input.pageUrl,
      summary: input.summary,
      max_clicks: input.count,
    });
    const held = await work.row(clickPlans, { task_id: input.taskId, status: 'held' });
    if (!held) throw new NotFound('계획을 붙잡지 못했어요');
    return new PlanHeldView(held);
  }
}

/** 계획 결재의 결정 (approvals.ts): 승인 → approved + 같은 작업을 다시 대기열로, 수정 요청 · 반려 · 취소 → dropped */
export async function planDecided(
  work: Work,
  decision: Decision,
  input: {
    approvalId: string;
    spaceId: string;
    targetId: string | null;
    targetVersion: number | null;
  },
): Promise<void> {
  const row = input.targetId
    ? await work.row(clickPlans, { id: input.targetId, space_id: input.spaceId })
    : null;
  // 이미 다룬 결재다 (같은 이벤트가 두 번 와도 결과가 같게)
  if (row?.approval_id === input.approvalId) return;
  const pending = row?.status === 'held' && row.version === input.targetVersion;
  if (decision !== 'granted') {
    if (row && pending) await movePlan(work, row, 'dropped', input.approvalId);
    return;
  }
  if (!row || !pending)
    return clickDone(
      work,
      input.spaceId,
      input.approvalId,
      '승인한 계획이 아니에요 (이미 닫혔거나 바뀌었어요)',
    );
  await movePlan(work, row, 'approved', input.approvalId);
  planContinues(work, input.spaceId, input.approvalId);
}

/**
 * 작업이 끝났거나(완료 · 실패 · 취소) 새 실행이 시작될 때: 끝났으면 열린 계획을 닫고, 어느 쪽이든 가져가지 않은 누르기 요청은 닫는다
 * (앞 실행의 AI가 기다리지 않는다). 닫은 것이 있으면 true
 */
export async function settlePlans(work: Work, taskId: string, ended: boolean): Promise<boolean> {
  let moved = false;
  for (const row of await work.rows(clicks, { task_id: taskId, status: 'requested' }))
    moved = (await moveClick(work, row, 'dropped', { reason: '실행이 끝났어요' })) || moved;
  if (!ended) return moved;
  for (const plan of await work.rows(clickPlans, {
    task_id: taskId,
    status: ['held', 'approved'],
  }))
    moved = (await movePlan(work, plan, plan.status === 'held' ? 'dropped' : 'closed')) || moved;
  return moved;
}

/** 이 작업 토큰의 일에서 승인된 계획. 없으면 거절 (AI에게 하는 말) */
export async function approvedPlan(work: Work, actor: Actor): Promise<ClickPlanRow> {
  const taskId = actor.runTask();
  if (!taskId) throw new RuleViolation('작업 토큰으로만 누르기를 요청해요');
  const plan = await work.row(clickPlans, {
    task_id: taskId,
    space_id: actor.requireSpace(),
    status: 'approved',
  });
  if (!plan)
    throw new RuleViolation(
      '승인된 누르기 계획이 없어요. 마지막 버튼 앞에서 browser-stop.json으로 멈춰요 (cairn-browse)',
    );
  return plan;
}

async function movePlan(
  work: Work,
  row: ClickPlanRow,
  status: ClickPlanRow['status'],
  approvalId: string | null = null,
): Promise<boolean> {
  const decided = approvalId ? { approval_id: approvalId, decided_at: Rule.now } : {};
  const n = await work.updateRows(
    clickPlans,
    { status, ...decided, version: row.version + 1 },
    { id: row.id, version: row.version },
  );
  return n > 0;
}

export async function moveClick(
  work: Work,
  row: ClickRow,
  status: ClickRow['status'],
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const n = await work.updateRows(
    clicks,
    { status, ...extra, version: row.version + 1 },
    { id: row.id, version: row.version, status: row.status },
  );
  return n > 0;
}
