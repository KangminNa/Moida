import { createHash } from 'node:crypto';
import {
  type Actor,
  Command,
  Conflict,
  NotFound,
  Operation,
  Read,
  Rule,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { SuggestionListView } from './review-views';
import { browseSeen, sites, suggestions } from './schema';
import type { SiteRow } from './tables';

// 되풀이되는 일 알아채기 (2026-11-16 MCP 3단계, docs/MCP.md 7장). 사이트 일을 빌릴 때(browser_job) 지시의 열쇠를 남기고,
// 같은 사이트 · 같은 열쇠의 일이 14일 안에 3번이면 "도구로 만들면 좋을 일"로 제안한다. 열쇠는 지시를 정규화한 sha256:
// 소문자로, 따옴표 안 글자와 숫자 묶음은 #로, 공백은 하나로 ("005930 종가 알려줘" = "000660 종가 알려줘").
// 제안은 사이트 · 열쇠마다 하나: 도구를 만들었거나(made) 그만 보기(dismissed)면 다시 내지 않는다

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
