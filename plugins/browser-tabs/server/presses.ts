import { setTimeout as sleep } from 'node:timers/promises';
import {
  Actor,
  Command,
  Conflict,
  NotFound,
  Read,
  Rule,
  RuleViolation,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { leasedBrowse, pageUrlOf } from './job';
import { NextPressView, PressView } from './plan-views';
import { approvedPlan, moveClick } from './plans';
import { clickPlans, clicks, sites } from './schema';
import { addShot, confirmOf, decodeImage, imageOf } from './shots';
import type { ClickRow, ClickStatus } from './tables';

// 계획 안의 누르기 (F2, 2026-11-21, plans.ts의 계획이 승인된 뒤). 에이전트가 버튼마다 요청하고(browser_press),
// 러너(AI 없음)가 가져가(browser_press_next) 버튼을 다시 찾아 누르고 결과를 남긴다(browser_press_save).
// 에이전트는 browser_press_result로 결과를 본다. 한 번에 하나 (DB의 열린 클릭 부분 유일 인덱스)

/** browser_press_result가 기다리는 최대 초 */
const WAIT_MAX = 20;
/** 아직 끝나지 않은 누르기 */
const PRESSING: readonly ClickStatus[] = ['requested', 'clicking'];
const ROLE = /^[a-z]{1,40}$/;
const SPAN = 100_000;

type PressInput = { pageUrl: string; role: string; name: string; nth: number; note: string | null };

/**
 * MCP browser_press: 승인된 계획 안에서 버튼 하나를 눌러 달라고 한다 (에이전트, 작업 토큰). 러너가 다시 찾아 누른다.
 * 한 번에 하나: 앞 누르기가 끝나야 다음을 요청한다. 답의 click_id로 browser_press_result를 본다
 */
export class RequestPress extends Command<PressInput> {
  readonly name = 'requestPress';
  readonly allow = Actor.AGENT_OUT;

  input(raw: unknown): PressInput {
    return this.fields(raw, (f) => {
      const role = f.text('role', 40).toLowerCase();
      if (role && !ROLE.test(role)) f.reject('role', '역할은 소문자 영어예요 (button · link …)');
      return {
        pageUrl: pageUrlOf(f, 'page_url'),
        role,
        name: f.text('name', 200),
        nth: f.optionalInteger('nth', 0, 50) ?? 0,
        note: f.optionalText('note', 500),
      };
    });
  }

  async run(work: Work, actor: Actor, input: PressInput): Promise<PressView> {
    const space = actor.requireSpace();
    const plan = await approvedPlan(work, actor);
    if (plan.used >= plan.max_clicks)
      throw new RuleViolation(
        `계획한 ${plan.max_clicks}번을 다 눌렀어요. 더 누를 일은 새 계획으로`,
      );
    const site = await work.row(sites, { id: plan.site_id, space_id: space });
    if (!site?.origins.includes(new URL(input.pageUrl).origin))
      throw new RuleViolation('계획한 사이트(허용 출처) 밖의 페이지예요');
    const open = await work.row(clicks, { task_id: plan.task_id, status: [...PRESSING] });
    if (open)
      throw new Conflict('앞 누르기가 끝난 뒤에 요청해요 (browser_press_result로 결과를 봐요)');
    await work.insertRows(clicks, {
      space_id: space,
      task_id: plan.task_id,
      site_id: plan.site_id,
      plan_id: plan.id,
      page_url: input.pageUrl,
      role: input.role,
      name: input.name,
      nth: input.nth,
      note: input.note,
      status: 'requested',
    });
    const asked = (await work.row(clicks, {
      task_id: plan.task_id,
      status: 'requested',
    })) as ClickRow;
    return new PressView(asked, plan);
  }
}

/** MCP browser_press_result { click_id, wait_seconds? }: 누르기의 결과. 끝날 때까지 최대 20초 기다린다 (그 작업의 에이전트만) */
export class PressResult extends Read<{ clickId: string; waitSeconds: number }> {
  readonly name = 'pressResult';
  readonly allow = Actor.AGENT_OUT;

  input(raw: unknown): { clickId: string; waitSeconds: number } {
    return this.fields(raw, (f) => ({
      clickId: f.uuid('click_id'),
      waitSeconds: f.optionalInteger('wait_seconds', 0, WAIT_MAX) ?? WAIT_MAX,
    }));
  }

  async run(
    work: Work,
    actor: Actor,
    input: { clickId: string; waitSeconds: number },
  ): Promise<PressView> {
    const taskId = actor.runTask();
    if (!taskId) throw new RuleViolation('작업 토큰으로만 볼 수 있어요');
    const where = { id: input.clickId, space_id: actor.requireSpace(), task_id: taskId };
    const deadline = Date.now() + input.waitSeconds * 1000;
    for (;;) {
      const row = await work.row(clicks, where);
      if (!row?.plan_id) throw new NotFound('이 일의 누르기가 아니에요');
      if (!PRESSING.includes(row.status) || Date.now() >= deadline)
        return new PressView(row, await work.row(clickPlans, { id: row.plan_id }));
      await sleep(1000);
    }
  }
}

/**
 * MCP browser_press_next { task_id }: 이 러너가 쥔 일에서 요청된 누르기 하나를 가져간다 (clicking). 가져갈 때 센다:
 * 계획이 닫혔거나 다 셌으면 그 요청은 닫는다. 없으면 null
 */
export class NextPress extends Command<{ taskId: string }> {
  readonly name = 'nextPress';
  readonly allow = Actor.RUN;

  input(raw: unknown): { taskId: string } {
    return this.fields(raw, (f) => ({ taskId: f.uuid('task_id') }));
  }

  async run(work: Work, actor: Actor, input: { taskId: string }): Promise<NextPressView> {
    await leasedBrowse(work, input.taskId);
    const row = await work.row(clicks, { task_id: input.taskId, status: 'requested' });
    if (!row?.plan_id) return new NextPressView(null);
    const plan = await work.row(clickPlans, { id: row.plan_id });
    if (plan?.status !== 'approved' || plan.used >= plan.max_clicks) {
      await moveClick(work, row, 'dropped', { reason: '계획이 닫혔거나 다 눌렀어요' });
      return new NextPressView(null);
    }
    const took = await moveClick(work, row, 'clicking', {
      runner_id: actor.id ?? '',
      clicked_at: Rule.now,
    });
    if (!took) return new NextPressView(null);
    await work.updateRows(
      clickPlans,
      { used: plan.used + 1, version: plan.version + 1 },
      { id: plan.id, version: plan.version },
    );
    return new NextPressView((await work.row(clicks, { id: row.id })) as ClickRow);
  }
}

type SaveInput = {
  taskId: string;
  clickId: string;
  version: number;
  outcome: 'clicked' | 'changed';
  reason: string | null;
  afterUrl: string | null;
  held: { tabId: string; box: Record<string, number>; fingerprint: string } | null;
  before: string | null;
  after: string | null;
  /** 누른 뒤 확인 (L3, confirmOf) */
  confirm: Pick<Partial<ClickRow>, 'confirm_state' | 'confirm_ref' | 'confirm_title'>;
};

/**
 * MCP browser_press_save: 러너가 누른 결과(clicked) 또는 누르지 않은 까닭(changed: 버튼이 없음 · 가려짐 · 바뀜)과
 * 다시 찾은 버튼(탭 · 자리 · 지문), 누르기 전 · 뒤 화면. 가져간 러너만
 */
export class SavePress extends Command<SaveInput> {
  readonly name = 'savePress';
  readonly allow = Actor.RUN;

  input(raw: unknown): SaveInput {
    return this.fields(raw, (f) => {
      const outcome = f.text('outcome', 10);
      if (outcome && !['clicked', 'changed'].includes(outcome))
        f.reject('outcome', 'clicked · changed 중 하나예요');
      const after = f.optionalText('after_url', 2000);
      const tabId = f.optionalText('tab_id', 64);
      const fingerprint = f.optionalText('fingerprint', 64);
      if (fingerprint && !/^[0-9a-f]{64}$/.test(fingerprint))
        f.reject('fingerprint', 'sha256(16진수 64자)이어야 해요');
      const box = tabId && fingerprint ? f.nested('box') : null;
      return {
        taskId: f.uuid('task_id'),
        clickId: f.uuid('click_id'),
        version: f.integer('version', 1, 2_147_483_647),
        outcome: outcome === 'clicked' ? 'clicked' : 'changed',
        reason: f.optionalText('reason', 500),
        afterUrl: after && /^https?:\/\//i.test(after) ? after : null,
        held:
          box && tabId && fingerprint
            ? {
                tabId,
                fingerprint,
                box: {
                  x: box.integer('x', -SPAN, SPAN),
                  y: box.integer('y', -SPAN, SPAN),
                  width: box.integer('width', 0, SPAN),
                  height: box.integer('height', 0, SPAN),
                },
              }
            : null,
        before: imageOf(f, 'before_image', false),
        after: imageOf(f, 'after_image', false),
        confirm: confirmOf(f, raw),
      };
    });
  }

  async run(work: Work, actor: Actor, input: SaveInput): Promise<PressView> {
    await leasedBrowse(work, input.taskId);
    const space = actor.requireSpace();
    const row = await work.row(clicks, {
      id: input.clickId,
      task_id: input.taskId,
      runner_id: actor.id ?? '',
    });
    if (!row?.plan_id) throw new NotFound('없는 누르기예요');
    if (row.status !== 'clicking' || row.version !== input.version)
      throw new Conflict(`누르는 중인 누르기가 아니에요 (${row.status})`);
    if (input.outcome === 'clicked' && !input.held)
      throw new RuleViolation('누른 버튼의 탭 · 자리 · 지문이 있어야 해요');
    const changed = input.outcome === 'changed';
    await moveClick(work, row, input.outcome, {
      reason: input.reason ?? (changed ? '버튼을 다시 찾지 못했어요' : null),
      after_url: input.afterUrl,
      ...input.confirm,
      ...(input.held
        ? { tab_id: input.held.tabId, box: input.held.box, fingerprint: input.held.fingerprint }
        : {}),
    });
    const page = { url: row.page_url, title: '' };
    if (input.before)
      await addShot(work, space, row.task_id, 'before', decodeImage(input.before), page, row.id);
    if (input.after)
      await addShot(
        work,
        space,
        row.task_id,
        changed ? 'changed' : 'after',
        decodeImage(input.after),
        { url: input.afterUrl ?? row.page_url, title: '' },
        row.id,
      );
    const saved = (await work.row(clicks, { id: row.id })) as ClickRow;
    return new PressView(saved, await work.row(clickPlans, { id: row.plan_id }));
  }
}
