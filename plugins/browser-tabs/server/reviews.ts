import {
  Actor,
  Command,
  DomainEvent,
  NotFound,
  Read,
  Rule,
  RuleViolation,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { requestBuild } from './integrations';
import { ENABLE_ACTION, INTEGRATION_TARGET } from './job';
import { ReviewMaterialView, ReviewSavedView } from './review-views';
import { integrationReviews, integrationRevisions, integrations, sites } from './schema';
import type { IntegrationRow } from './tables';

// 쓰기 사이트 도구의 검토자 짝 (2026-11-16 MCP 3단계, docs/MCP.md 7장). 쓰기 굳히기가 시험(마른 실행)을 통과하면 켜기 결재
// 대신 검토 일을 그 도구의 검토자(굳힌 에이전트와 다른 에이전트)에게 맡긴다. 검토자는 site_review_get으로 읽고
// site_review로 판정한다: 통과면 답의 켜기 결재를 올리고, 고칠 점이면 그 의견을 힌트로 한 번 다시 굳힌다 (두 번째면 끈다)

const NOTES_MAX = 2000;

/** 검토 일을 요청한다 (쓰기 굳히기가 받아들여졌을 때) */
export function requestReview(work: Work, row: Readonly<IntegrationRow>, seq: number): void {
  if (!row.reviewer_id) return;
  work.record(
    new DomainEvent('task.task.requested', 1, row.space_id, {
      requestId: `browser-tabs:review:${row.id}:${seq}`,
      kind: 'general',
      title: `사이트 도구 검토: ${row.title}`,
      instruction: `쓰기 사이트 도구 ${row.name} 버전 ${seq}을 검토합니다. site_review_get으로 읽고 site_review로 판정을 남깁니다.`,
      agentId: row.reviewer_id,
      targetKind: INTEGRATION_TARGET,
      targetId: row.id,
      baseVersion: row.version,
    }),
  );
}

/** 이 에이전트가 검토할 도구 (검토 중이고 검토자가 이 에이전트) */
async function reviewing(work: Work, actor: Actor, id: string): Promise<IntegrationRow> {
  const row = await work.row(integrations, { id, space_id: actor.requireSpace() });
  if (!row || row.reviewer_id !== actor.id)
    throw new NotFound('검토를 맡은 사이트 도구가 아니에요');
  if (row.status !== 'reviewing' || row.draft_seq === null)
    throw new RuleViolation('검토를 기다리는 도구가 아니에요');
  return row;
}

/** MCP site_review_get { integration_id }: 검토할 것 (그 도구의 검토자만) — 이름 · 설명 · 사이트 · 형식 · 코드 · 시험 결과 */
export class ReviewMaterial extends Read<{ id: string }> {
  readonly name = 'reviewMaterial';
  readonly allow = Actor.AGENT;

  input(raw: unknown): { id: string } {
    return this.fields(raw, (f) => ({ id: f.uuid('integration_id') }));
  }

  async run(work: Work, actor: Actor, input: { id: string }): Promise<ReviewMaterialView> {
    const row = await reviewing(work, actor, input.id);
    const seq = row.draft_seq ?? 0;
    const revision = await work.row(integrationRevisions, { integration_id: row.id, seq });
    const site = await work.row(sites, { id: row.site_id, space_id: row.space_id });
    if (!revision || !site) throw new NotFound('검토할 버전을 찾지 못했어요');
    return new ReviewMaterialView({
      integrationId: row.id,
      name: row.name,
      title: row.title,
      description: row.description,
      mode: row.mode,
      site: { name: site.name, origins: site.origins },
      seq,
      inputSchema: revision.input_schema,
      outputSchema: revision.output_schema,
      code: revision.code,
      tests: revision.tests,
    });
  }
}

type ReviewInput = { id: string; seq: number; verdict: string; notes: string };

/**
 * MCP site_review { integration_id, seq, verdict: pass · fix, notes }: 판정을 남긴다 (그 도구의 검토자만, 버전마다 한 번).
 * pass → 켜기를 기다리고 답에 올릴 켜기 결재. fix → 의견을 힌트로 다시 굳힌다 (앞 버전도 fix였으면 끈다)
 */
export class SaveReview extends Command<ReviewInput> {
  readonly name = 'saveReview';
  readonly allow = Actor.AGENT;

  input(raw: unknown): ReviewInput {
    return this.fields(raw, (f) => {
      const verdict = f.text('verdict', 10);
      if (verdict !== 'pass' && verdict !== 'fix') f.reject('verdict', 'pass · fix 중 하나예요');
      return {
        id: f.uuid('integration_id'),
        seq: f.integer('seq', 1, 100_000),
        verdict,
        notes: f.optionalText('notes', NOTES_MAX) ?? '',
      };
    });
  }

  async run(work: Work, actor: Actor, input: ReviewInput): Promise<ReviewSavedView> {
    const row = await reviewing(work, actor, input.id);
    if (row.draft_seq !== input.seq)
      throw new RuleViolation(`검토할 버전은 ${row.draft_seq}이에요`);
    if (input.verdict === 'fix' && !input.notes.trim())
      throw new RuleViolation('고칠 점(notes)을 적어 주세요');
    await work.insertRows(integrationReviews, {
      space_id: row.space_id,
      integration_id: row.id,
      seq: input.seq,
      reviewer_id: actor.id ?? '',
      verdict: input.verdict,
      notes: input.notes,
    });
    const version = row.version + 1;
    if (input.verdict === 'pass') {
      await work.updateRows(
        integrations,
        { status: 'review', version, updated_at: Rule.now },
        { id: row.id, version: row.version },
      );
      return new ReviewSavedView('pass', {
        action: ENABLE_ACTION,
        target_kind: INTEGRATION_TARGET,
        target_id: row.id,
        target_version: version,
      });
    }
    const again = await work.exists(integrationReviews, {
      integration_id: row.id,
      seq: input.seq - 1,
      verdict: 'fix',
    });
    if (again) {
      await work.updateRows(
        integrations,
        {
          status: 'off',
          last_error: `검토에서 두 번 고칠 점: ${input.notes}`.slice(0, 500),
          version,
          updated_at: Rule.now,
        },
        { id: row.id, version: row.version },
      );
      return new ReviewSavedView('fix', null);
    }
    const hint = `${row.hint}\n\n검토자의 고칠 점 (버전 ${input.seq}):\n${input.notes}`.slice(
      -4000,
    );
    await work.updateRows(
      integrations,
      { status: 'building', hint, version, updated_at: Rule.now },
      { id: row.id, version: row.version },
    );
    const next = { ...row, status: 'building', hint, version };
    requestBuild(work, row.space_id, next, `review-fix:${row.id}:${input.seq}`, row.agent_id);
    return new ReviewSavedView('fix', null);
  }
}
