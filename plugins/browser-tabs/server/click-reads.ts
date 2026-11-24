import {
  type Actor,
  NotFound,
  Operation,
  Read,
  Rule,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { ClickDetailView, ClickListView, ClickView } from './click-views';
import { clicks, shots, sites } from './schema';
import { shotsOf } from './shots';
import { CLICK_STATUS } from './tables';

// 결재된 클릭의 콘솔 읽기 (clicks.ts에서 뗌, 2026-11-24): 최근 클릭 목록과 클릭 하나 (승인 화면이 그린다)

/** GET /api/p/browser-tabs/clicks?status=: 최근 클릭 (관리자) */
export class ListClicks extends Read<{ status: string | null }> {
  static readonly LIMIT = 50;
  readonly name = 'listClicks';
  readonly allow = Operation.OWNER;

  input(raw: unknown): { status: string | null } {
    return this.fields(raw, (f) => ({ status: f.optionalText('status', 20) }));
  }

  async run(work: Work, actor: Actor, input: { status: string | null }): Promise<ClickListView> {
    const space = actor.requireSpace();
    // 값 목록 밖의 상태에 맞는 클릭은 없다 (CHECK)
    const status = CLICK_STATUS.find((s) => s === input.status);
    if (input.status !== null && !status) return new ClickListView([]);
    const rows = await work.rows(
      clicks,
      { space_id: space, status: Rule.maybe(status) },
      { order: ['id desc'], limit: ListClicks.LIMIT },
    );
    const names = new Map(
      (await work.rows(sites, { space_id: space })).map((s) => [s.id, s.name] as const),
    );
    return new ClickListView(rows.map((r) => new ClickView(r, names.get(r.site_id) ?? null)));
  }
}

/** GET /api/p/browser-tabs/clicks/:id: 클릭 하나와 멈춘 화면 · 누른 뒤 화면, 그 작업의 화면 목록 (관리자. 결재 화면이 그린다) */
export class ClickDetail extends Read<{ id: string }> {
  readonly name = 'click';
  readonly allow = Operation.OWNER;

  input(raw: unknown): { id: string } {
    return this.fields(raw, (f) => ({ id: f.uuid('id') }));
  }

  async run(work: Work, actor: Actor, input: { id: string }): Promise<ClickDetailView> {
    const space = actor.requireSpace();
    const row = await work.row(clicks, { id: input.id, space_id: space });
    if (!row) throw new NotFound('없는 클릭이에요');
    const site = await work.row(sites, { id: row.site_id, space_id: space });
    const before = await work.row(shots, { click_id: row.id, kind: 'before' });
    const after = await work.row(shots, { click_id: row.id, kind: ['after', 'changed'] });
    return new ClickDetailView(
      new ClickView(row, site?.name ?? null),
      before,
      after,
      await shotsOf(work, space, row.task_id),
    );
  }
}
