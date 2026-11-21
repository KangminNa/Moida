import { createHash } from 'node:crypto';
import {
  type Actor,
  Command,
  Conflict,
  type LeasedWork,
  NotFound,
  Operation,
  Read,
  Rule,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { SuggestionListView } from './review-views';
import { browseSeen, clickPlans, clicks, sites, suggestions } from './schema';
import type { SiteRow } from './tables';

// 되풀이되는 일 알아채기 (2026-11-16 MCP 3단계, docs/MCP.md 7장). 사이트 일을 빌릴 때(browser_job) 지시의 열쇠를 남기고,
// 같은 사이트 · 같은 열쇠의 일이 14일 안에 3번이면 "도구로 만들면 좋을 일"로 제안한다. 열쇠는 지시를 정규화한 sha256:
// 소문자로, 따옴표 안 글자와 숫자 묶음은 #로, 공백은 하나로 ("005930 종가 알려줘" = "000660 종가 알려줘").
// 제안은 사이트 · 열쇠마다 하나: 도구를 만들었거나(made) 그만 보기(dismissed)면 다시 내지 않는다.
// 승인한 누르기 계획으로 실제로 누른 일에서 쓰기 API(GET이 아닌 2xx)가 기록되면 되풀이를 기다리지 않고 바로 쓰기 도구를 제안한다
// (2026-11-21, 까닭은 note에). 쓰기 도구는 만들 때 검토자 짝, 부를 때마다 승인이라 제안이 바로 떠도 원칙 7은 그대로다

const WINDOW_DAYS = 14;
const REPEATS = 3;
const SAMPLE_MAX = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 지시의 열쇠 (같은 모양의 일이면 같다) */
export function repeatKey(instruction: string): string {
  const shape = instruction
    .toLowerCase()
    .replace(/(["'“”‘’`]).*?\1/g, '#')
    .replace(/\d+([.,:/-]\d+)*/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(shape).digest('hex');
}

/**
 * 사이트 일 하나를 남기고, 되풀이면 제안을 열거나 횟수를 올린다. 같은 작업은 한 번만 센다 (다시 빌려도).
 * 지시가 비면 세지 않는다
 */
export async function noteBrowse(
  work: Work,
  site: Readonly<SiteRow>,
  taskId: string,
  instruction: string,
): Promise<void> {
  if (!instruction.trim()) return;
  if (await work.exists(browseSeen, { task_id: taskId })) return;
  const key = repeatKey(instruction);
  await work.insertRows(browseSeen, {
    space_id: site.space_id,
    site_id: site.id,
    task_id: taskId,
    key,
  });
  const [seen] = await work.sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM browser_tabs.browse_seen
    WHERE site_id = ${site.id} AND key = ${key}
      AND created_at > now() - make_interval(days => ${WINDOW_DAYS})`;
  const count = seen?.n ?? 0;
  if (count < REPEATS) return;
  const sample = instruction.trim().slice(0, SAMPLE_MAX);
  const open = await work.row(suggestions, { site_id: site.id, key });
  if (!open) {
    await work.insertRows(suggestions, {
      space_id: site.space_id,
      site_id: site.id,
      key,
      count,
      sample,
    });
    return;
  }
  if (open.status === 'open')
    await work.updateRows(suggestions, { count, sample, last_seen_at: Rule.now }, { id: open.id });
}

/** 기록된 요청 중 쓰기(GET · HEAD · OPTIONS가 아닌 2xx)의 "방법 경로" 목록 */
export function writeShapes(
  requests: readonly { method: string; path: string; status: number }[],
): string[] {
  return [
    ...new Set(
      requests
        .filter(
          (r) =>
            !['GET', 'HEAD', 'OPTIONS'].includes(r.method) && r.status >= 200 && r.status < 300,
        )
        .map((r) => `${r.method} ${r.path}`),
    ),
  ];
}

/**
 * 승인한 누르기 계획이 있는 일이 실제로 눌렀고 쓰기 API가 기록됐으면 바로 제안을 연다.
 * 열쇠는 되풀이와 같아(지시의 모양) 뒤의 되풀이와 합쳐지고, 이미 있는 제안이면 까닭만 새로 적는다. 새로 열었을 때만 true
 */
export async function suggestWriteTool(
  work: Work,
  site: Readonly<SiteRow>,
  job: LeasedWork,
  shapes: readonly string[],
): Promise<boolean> {
  if (shapes.length === 0) return false;
  // 계획은 작업에 하나: 승인된(approved) 채로 돌거나, 끝나면서 닫힘(closed). 들어 둔(held) · 반려(dropped)는 아니다
  const plan = await work.row(clickPlans, {
    task_id: job.id,
    site_id: site.id,
    status: ['approved', 'closed'],
  });
  if (!plan) return false;
  if (!(await work.exists(clicks, { task_id: job.id, plan_id: plan.id, status: 'clicked' })))
    return false;
  const text = job.instruction.trim() || `누르기 계획 ${plan.summary}`;
  const key = repeatKey(text);
  const note =
    `승인한 누르기 계획 "${plan.summary}"에서 기록한 쓰기 API: ${shapes.join(', ')}`.slice(
      0,
      SAMPLE_MAX,
    );
  const open = await work.row(suggestions, { site_id: site.id, key });
  if (open) {
    if (open.status === 'open')
      await work.updateRows(suggestions, { note, last_seen_at: Rule.now }, { id: open.id });
    return false;
  }
  const [seen] = await work.sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM browser_tabs.browse_seen WHERE site_id = ${site.id} AND key = ${key}`;
  await work.insertRows(suggestions, {
    space_id: site.space_id,
    site_id: site.id,
    key,
    count: Math.max(seen?.n ?? 0, 1),
    sample: text.slice(0, SAMPLE_MAX),
    note,
  });
  return true;
}

/** GET /api/p/browser-tabs/suggestions: 열린 제안 (관리자, 최근 것부터) */
export class ListSuggestions extends Read<null> {
  readonly name = 'suggestions';
  readonly allow = Operation.OWNER;

  input(): null {
    return null;
  }

  async run(work: Work, actor: Actor): Promise<SuggestionListView> {
    const space = actor.requireSpace();
    const rows = await work.rows(
      suggestions,
      {
        space_id: space,
        status: 'open',
        last_seen_at: Rule.after(new Date(Date.now() - 60 * DAY_MS)),
      },
      { order: ['last_seen_at desc'], limit: 20 },
    );
    const names = new Map((await work.rows(sites, { space_id: space })).map((s) => [s.id, s.name]));
    return new SuggestionListView(rows, names);
  }
}

/** POST /api/p/browser-tabs/suggestions/:id/dismiss { version }: 그만 보기 (관리자) */
export class DismissSuggestion extends Command<{ id: string; version: number }> {
  readonly name = 'dismissSuggestion';
  readonly allow = Operation.OWNER;

  input(raw: unknown): { id: string; version: number } {
    return this.fields(raw, (f) => ({ id: f.uuid('id'), version: f.version() }));
  }

  async run(work: Work, actor: Actor, input: { id: string; version: number }) {
    const space = actor.requireSpace();
    const row = await work.row(suggestions, { id: input.id, space_id: space });
    if (!row) throw new NotFound('없는 제안이에요');
    const changed = await work.updateRows(
      suggestions,
      { status: 'dismissed', version: row.version + 1, updated_at: Rule.now },
      { id: row.id, version: input.version },
    );
    if (changed === 0) throw new Conflict('다른 곳에서 먼저 고쳤어요. 새로 불러와 주세요');
    return new ListSuggestions().run(work, actor);
  }
}

/** 도구를 만들었다: 그 제안을 닫는다 (BuildIntegration). 없는 제안이면 아무것도 하지 않는다 */
export async function suggestionMade(
  work: Work,
  space: string,
  suggestionId: string,
  integrationId: string,
): Promise<void> {
  await work.updateRows(
    suggestions,
    { status: 'made', integration_id: integrationId, updated_at: Rule.now },
    { id: suggestionId, space_id: space, status: 'open' },
  );
}
