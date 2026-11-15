import {
  type Actor,
  Command,
  Conflict,
  DomainEvent,
  NotFound,
  Operation,
  Read,
  type RequestFields,
  Rule,
  RuleViolation,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { IntegrationDetailView, IntegrationListView, IntegrationView } from './integration-views';
import { BROWSE_KIND, INTEGRATION_TARGET } from './job';
import { suggestionMade } from './repeats';
import { reviewJson } from './review-views';
import { integrationReviews, integrationRevisions, integrations, runs, sites } from './schema';
import type { IntegrationReviewRow, IntegrationRow } from './tables';
import { AskedView } from './views';

// 사이트 도구 (2026-11-16 MCP 2단계, docs/MCP.md 6장): 사이트에서 되풀이하는 읽기 일을 Playwright 코드로 굳힌 것.
// 관리자가 굳히기를 맡기면(도구로 만들기) 코어에 browse 작업을 요청하고(대상 browser_integration), 서버 러너의 AI가
// 사이트를 둘러보며 코드 · 형식 · 시험을 쓰고 러너가 시험해 site_build_save로 남긴다 (integration-build.ts).
// 시험을 통과하면 켜기 결재(browser.integration.enable)나 관리자의 켜기로 켠다. 실행은 site-runs.ts

const NAME = /^[a-z][a-z0-9_]{1,39}$/;
const DETAIL_REVISIONS = 5;
const DETAIL_RUNS = 20;

async function integrationOf(work: Work, actor: Actor, id: string): Promise<IntegrationRow> {
  const row = await work.row(integrations, { id, space_id: actor.requireSpace() });
  if (!row) throw new NotFound('없는 사이트 도구예요');
  return row;
}

async function siteNames(work: Work, space: string): Promise<Map<string, string>> {
  const rows = await work.rows(sites, { space_id: space });
  return new Map(rows.map((s) => [s.id, s.name]));
}

/** 굳히기 작업을 코어에 요청한다. 지시는 도구의 이름 · 설명 · 힌트 (어떻게 굳히는지는 러너의 지시문 틀 site-build) */
export function requestBuild(
  work: Work,
  space: string,
  row: Readonly<IntegrationRow>,
  requestId: string,
  agentId: string | null,
): AskedView {
  const id = `browser-tabs:integration:${requestId}`;
  work.record(
    new DomainEvent('task.task.requested', 1, space, {
      requestId: id,
      kind: BROWSE_KIND,
      title: `도구 만들기: ${row.title}`,
      instruction: [`사이트 도구 ${row.name}: ${row.description}`, row.hint]
        .filter(Boolean)
        .join('\n\n'),
      agentId,
      targetKind: INTEGRATION_TARGET,
      targetId: row.id,
      baseVersion: row.version,
    }),
  );
  return new AskedView(id);
}

/** 담당 에이전트 칸 (비우면 browse 권한이 있는 에이전트가 맡는다) */
function agentOf(f: RequestFields, raw: unknown): string | null {
  const agent = (raw as { agentId?: unknown } | null)?.agentId;
  return agent === undefined || agent === null ? null : f.uuid('agentId');
}

/** GET /api/p/browser-tabs/integrations: 사이트 도구 목록 (관리자) */
export class ListIntegrations extends Read<null> {
  readonly name = 'integrations';
  readonly allow = Operation.OWNER;

  input(): null {
    return null;
  }

  async run(work: Work, actor: Actor): Promise<IntegrationListView> {
    const space = actor.requireSpace();
    const names = await siteNames(work, space);
    const rows = await work.rows(integrations, { space_id: space }, { order: ['id desc'] });
    const reviews = await work.sql<IntegrationReviewRow[]>`
      SELECT DISTINCT ON (integration_id) * FROM browser_tabs.integration_reviews
      WHERE space_id = ${space} ORDER BY integration_id, seq DESC`;
    const latest = new Map(reviews.map((r) => [r.integration_id, r]));
    return new IntegrationListView(
      rows.map(
        (r) =>
          new IntegrationView(r, names.get(r.site_id) ?? '', reviewJson(latest.get(r.id) ?? null)),
      ),
    );
  }
}

/** GET /api/p/browser-tabs/integrations/:id: 도구 하나와 최근 버전 · 실행 (관리자) */
export class IntegrationDetail extends Read<{ id: string }> {
  readonly name = 'integration';
  readonly allow = Operation.OWNER;

  input(raw: unknown): { id: string } {
    return this.fields(raw, (f) => ({ id: f.uuid('id') }));
  }

  async run(work: Work, actor: Actor, input: { id: string }): Promise<IntegrationDetailView> {
    const row = await integrationOf(work, actor, input.id);
    const site = await work.row(sites, { id: row.site_id, space_id: row.space_id });
    const revisions = await work.rows(
      integrationRevisions,
      { integration_id: row.id },
      { order: ['seq desc'], limit: DETAIL_REVISIONS },
    );
    const recent = await work.rows(
      runs,
      { integration_id: row.id },
      { order: ['id desc'], limit: DETAIL_RUNS },
    );
    return new IntegrationDetailView(new IntegrationView(row, site?.name ?? ''), revisions, recent);
  }
}

type BuildInput = {
  requestId: string;
  siteId: string;
  name: string;
  title: string;
  description: string;
  hint: string;
  agentId: string | null;
  /** 읽기 · 쓰기 (2026-11-16 MCP 3단계). 쓰기는 검토자가 있어야 한다 */
  mode: string;
  reviewerId: string | null;
  /** 되풀이 제안에서 만들면 그 제안 (만들면 닫는다) */
  suggestionId: string | null;
};

/** 고를 수 있는 uuid 칸 (비우면 null) */
function optionalId(f: RequestFields, raw: unknown, name: string): string | null {
  const value = (raw as Record<string, unknown> | null)?.[name];
  return value === undefined || value === null || value === '' ? null : f.uuid(name);
}

/**
 * POST /api/p/browser-tabs/integrations { requestId, siteId, name, title, description, hint?, agentId? }:
 * 도구로 만들기 (관리자). 도구를 굳히는 중으로 만들고 굳히기 작업을 요청한다. 힌트에는 앞선 브라우저 일의 지시 · 답을 적는다
 */
export class BuildIntegration extends Command<BuildInput> {
  readonly name = 'buildIntegration';
  readonly allow = Operation.OWNER;

  input(raw: unknown): BuildInput {
    return this.fields(raw, (f) => ({
      requestId: f.text('requestId', 100),
      siteId: f.uuid('siteId'),
      name: f.text('name', 40),
      title: f.text('title', 60),
      description: f.text('description', 300),
      hint: f.optionalText('hint', 4000) ?? '',
      agentId: agentOf(f, raw),
      mode: f.optionalText('mode', 10) ?? 'read',
      reviewerId: optionalId(f, raw, 'reviewerId'),
      suggestionId: optionalId(f, raw, 'suggestionId'),
    }));
  }

  async run(work: Work, actor: Actor, input: BuildInput): Promise<AskedView> {
    const space = actor.requireSpace();
    if (!NAME.test(input.name))
      throw new RuleViolation('이름은 영문 소문자로 시작하는 소문자 · 숫자 · _ 2~40자예요');
    if (input.mode !== 'read' && input.mode !== 'write')
      throw new RuleViolation('도구는 읽기(read) · 쓰기(write) 중 하나예요');
    if (input.mode === 'write' && !input.reviewerId)
      throw new RuleViolation('쓰기 도구는 검토자(다른 AI 도구의 에이전트)를 정해야 해요');
    if (input.reviewerId && input.reviewerId === input.agentId)
      throw new RuleViolation('검토자는 굳히는 에이전트와 달라야 해요');
    if (!(await work.exists(sites, { id: input.siteId, space_id: space })))
      throw new NotFound('없는 사이트예요');
    if (await work.exists(integrations, { space_id: space, name: input.name }))
      throw new Conflict(`같은 이름의 도구가 있어요: ${input.name}`);
    await work.insertRows(integrations, {
      space_id: space,
      site_id: input.siteId,
      name: input.name,
      title: input.title.trim(),
      description: input.description.trim(),
      hint: input.hint,
      agent_id: input.agentId,
      mode: input.mode,
      reviewer_id: input.reviewerId,
    });
    const row = await work.row(integrations, { space_id: space, name: input.name });
    if (!row) throw new NotFound('도구를 만들지 못했어요');
    if (input.suggestionId) await suggestionMade(work, space, input.suggestionId, row.id);
    return requestBuild(work, space, row, input.requestId, input.agentId);
  }
}

type RebuildInput = {
  id: string;
  version: number;
  requestId: string;
  hint: string | null;
  agentId: string | null;
};

/**
 * POST /api/p/browser-tabs/integrations/:id/build { version, requestId, hint?, agentId? }: 다시 굳히기 · 고치기 (관리자).
 * 켜진 도구는 끈 뒤에 고친다 (굳히는 동안 옛 버전을 부르지 않게). 러너에게는 앞 버전과 최근 실패가 함께 간다
 */
export class RebuildIntegration extends Command<RebuildInput> {
  readonly name = 'rebuildIntegration';
  readonly allow = Operation.OWNER;

  input(raw: unknown): RebuildInput {
    return this.fields(raw, (f) => ({
      id: f.uuid('id'),
      version: f.version(),
      requestId: f.text('requestId', 100),
      hint: f.optionalText('hint', 4000),
      agentId: agentOf(f, raw),
    }));
  }

  async run(work: Work, actor: Actor, input: RebuildInput): Promise<AskedView> {
    const row = await integrationOf(work, actor, input.id);
    if (row.status === 'building' || row.status === 'reviewing')
      throw new RuleViolation('이미 굳히거나 검토하는 중이에요');
    if (row.status === 'on') throw new RuleViolation('켜진 도구는 끈 뒤에 고쳐요');
    const hint = input.hint ?? row.hint;
    const changed = await work.updateRows(
      integrations,
      { status: 'building', hint, version: row.version + 1, updated_at: Rule.now },
      { id: row.id, version: input.version },
    );
    if (changed === 0) throw new Conflict('다른 곳에서 먼저 고쳤어요. 새로 불러와 주세요');
    const next: Readonly<IntegrationRow> = {
      ...row,
      status: 'building',
      hint,
      version: row.version + 1,
    };
    return requestBuild(work, actor.requireSpace(), next, input.requestId, input.agentId);
  }
}

type VersionInput = { id: string; version: number };

/** 판을 확인하고 칸을 바꾼다. 판이 다르면 Conflict */
async function change(
  work: Work,
  row: Readonly<IntegrationRow>,
  version: number,
  changes: Partial<IntegrationRow>,
): Promise<void> {
  const changed = await work.updateRows(
    integrations,
    { ...changes, version: row.version + 1, updated_at: Rule.now },
    { id: row.id, version },
  );
  if (changed === 0) throw new Conflict('다른 곳에서 먼저 고쳤어요. 새로 불러와 주세요');
}

/** 판만 받는 동작의 입력 */
function versionOf(f: RequestFields): VersionInput {
  return { id: f.uuid('id'), version: f.version() };
}

/**
 * POST /api/p/browser-tabs/integrations/:id/enable { version }: 켜기 (관리자). 시험을 통과한 마지막 버전(draft)을 켠다.
 * 켜기 결재(browser.integration.enable)를 올릴 수 없는 에이전트가 굳힌 도구도 여기서 켠다
 */
export class EnableIntegration extends Command<VersionInput> {
  readonly name = 'enableIntegration';
  readonly allow = Operation.OWNER;

  input(raw: unknown): VersionInput {
    return this.fields(raw, versionOf);
  }

  async run(work: Work, actor: Actor, input: VersionInput): Promise<IntegrationListView> {
    const row = await integrationOf(work, actor, input.id);
    if (row.draft_seq === null) throw new RuleViolation('시험을 통과한 버전이 없어요');
    if (row.status === 'building' || row.status === 'reviewing')
      throw new RuleViolation('굳히거나 검토하는 중이에요');
    if (row.mode === 'write' && !(await passed(work, row.id, row.draft_seq)))
      throw new RuleViolation('쓰기 도구는 검토자의 통과가 있어야 켜요');
    await change(work, row, input.version, {
      status: 'on',
      live_seq: row.draft_seq,
      fail_streak: 0,
    });
    return new ListIntegrations().run(work, actor);
  }
}

/** POST /api/p/browser-tabs/integrations/:id/off { version }: 끄기 (관리자). 기다리던 실행은 러너가 꺼낼 때 실패로 끝난다 */
export class TurnOffIntegration extends Command<VersionInput> {
  readonly name = 'offIntegration';
  readonly allow = Operation.OWNER;

  input(raw: unknown): VersionInput {
    return this.fields(raw, versionOf);
  }

  async run(work: Work, actor: Actor, input: VersionInput): Promise<IntegrationListView> {
    const row = await integrationOf(work, actor, input.id);
    await change(work, row, input.version, { status: 'off' });
    return new ListIntegrations().run(work, actor);
  }
}

/** DELETE /api/p/browser-tabs/integrations/:id { version }: 지우기 (관리자). 버전 · 실행 기록도 함께 (설정이라서) */
export class DeleteIntegration extends Command<VersionInput> {
  readonly name = 'deleteIntegration';
  readonly allow = Operation.OWNER;

  input(raw: unknown): VersionInput {
    return this.fields(raw, versionOf);
  }

  async run(work: Work, actor: Actor, input: VersionInput): Promise<IntegrationListView> {
    const row = await integrationOf(work, actor, input.id);
    if (row.status === 'building')
      throw new RuleViolation('굳히는 중에는 지우지 않아요. 작업을 먼저 멈춰 주세요');
    const gone = await work.deleteRows(integrations, { id: row.id, version: input.version });
    if (gone === 0) throw new Conflict('다른 곳에서 먼저 고쳤어요. 새로 불러와 주세요');
    return new ListIntegrations().run(work, actor);
  }
}

/** 이 버전이 검토자의 통과를 받았는가 (쓰기 도구를 켜기 전에) */
export async function passed(work: Work, integrationId: string, seq: number): Promise<boolean> {
  return work.exists(integrationReviews, { integration_id: integrationId, seq, verdict: 'pass' });
}
