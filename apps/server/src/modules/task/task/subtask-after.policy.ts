import { RuleViolation } from '../../platform';
import type { TaskRow } from '../task.tables';
import type { SubtaskOrder } from './subtask-order.input';

/** 위 작업에 적어 둔 하위 작업 하나: 열쇠(request_id) · 앞 단계의 열쇠 · 받은 모양 그대로 */
export interface AfterOrderRow {
  key: string;
  after: string[];
  order: Record<string, unknown>;
}

/** 앞 단계가 된 형제 하나 (TaskRepository.afterRows) */
export type AfterSiblingRow = Pick<TaskRow, 'id' | 'request_id' | 'status' | 'title' | 'result'>;

// 순서가 있는 위임 (D2 `after`, 기획서 결정 2026-11-17 "위임 계약" · 2026-11-21): delegate_task의 하위 작업이 after로 같은 호출의
// 앞 하위 작업을 가리키면, 서버는 바로 만들지 않고 위 작업의 payload.afterOrders에 적어 둔다. 앞 단계가 모두 끝나면(done)
// SubtaskService가 그 하위 작업을 만들고 앞 단계의 결과 글을 payload.afterResults로 넘긴다. 앞 단계 하나가 실패 · 취소되면
// 시작하지 않고 지운다 (위 작업은 실패로 이미 깨어 다시 정한다). 대표가 단계마다 다시 뜨지 않아도 되게 하는 것이 목적이다. 상태 없음
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. TaskService(위임)와 SubtaskService(시작)가 쓴다
export class SubtaskAfter {
  static readonly RESULT_MAX = 3000;
  private static readonly DONE = 'done';
  private static readonly ENDED = ['failed', 'cancelled'];

  /** 바로 맡길 것과 앞 단계를 기다릴 것. after는 같은 호출에서 앞에 적은 하위 작업만 (아니면 RuleViolation) */
  static split(orders: readonly SubtaskOrder[]): { now: SubtaskOrder[]; later: SubtaskOrder[] } {
    const seen = new Set<string>();
    const now: SubtaskOrder[] = [];
    const later: SubtaskOrder[] = [];
    for (const order of orders) {
      const unknown = order.after.find((a) => !seen.has(a));
      if (unknown !== undefined)
        throw new RuleViolation(
          `after에는 같은 호출에서 앞에 적은 request_id만 적어요: ${unknown}`,
        );
      seen.add(order.requestId);
      (order.after.length > 0 ? later : now).push(order);
    }
    return { now, later };
  }

  /** 위 작업에 적어 둔다 (열쇠는 위 작업마다 따로 센 request_id, DelegationPolicy.requestIdOf) */
  static hold(
    payload: Readonly<Record<string, unknown>>,
    later: readonly SubtaskOrder[],
    keyOf: (requestId: string) => string,
  ): Record<string, unknown> {
    const added = later.map((o) => ({
      key: keyOf(o.requestId),
      after: o.after.map(keyOf),
      order: o.raw,
    }));
    return { ...payload, afterOrders: [...SubtaskAfter.held(payload), ...added] };
  }

  /** 적어 둔 하위 작업 */
  static held(payload: unknown): AfterOrderRow[] {
    const list = (payload as { afterOrders?: unknown } | null)?.afterOrders;
    return Array.isArray(list) ? (list as AfterOrderRow[]) : [];
  }

  /** 앞 단계가 모두 끝난 것(ready) · 하나라도 실패 · 취소된 것(dropped) · 아직 기다리는 것(rest) */
  static due(held: readonly AfterOrderRow[], siblings: readonly AfterSiblingRow[]) {
    const statusOf = (key: string) => siblings.find((s) => s.request_id === key)?.status ?? null;
    const ready: AfterOrderRow[] = [];
    const dropped: AfterOrderRow[] = [];
    const rest: AfterOrderRow[] = [];
    for (const item of held) {
      const states = item.after.map(statusOf);
      if (states.some((s) => s !== null && SubtaskAfter.ENDED.includes(s))) dropped.push(item);
      else if (states.every((s) => s === SubtaskAfter.DONE)) ready.push(item);
      else rest.push(item);
    }
    return { ready, dropped, rest };
  }

  /** 남은 것만 적은 payload (모두 시작했으면 칸을 뺀다) */
  static withRest(payload: Readonly<Record<string, unknown>>, rest: readonly AfterOrderRow[]) {
    const { afterOrders: _, ...others } = payload;
    return rest.length > 0 ? { ...others, afterOrders: [...rest] } : others;
  }

  /** 앞 단계의 결과 글 (하위 작업의 payload.afterResults, 러너가 "앞 단계 결과"로 보인다) */
  static results(item: AfterOrderRow, siblings: readonly AfterSiblingRow[]) {
    return item.after.flatMap((key) => {
      const row = siblings.find((s) => s.request_id === key);
      if (!row) return [];
      const text = (row.result as { text?: unknown } | null)?.text;
      const said = typeof text === 'string' ? text : '';
      return [{ taskId: row.id, title: row.title, text: said.slice(0, SubtaskAfter.RESULT_MAX) }];
    });
  }
}
