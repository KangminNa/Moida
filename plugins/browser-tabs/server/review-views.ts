import type { IntegrationReviewRow, SuggestionRow } from './tables';

// MCP 3단계(2026-11-16)가 내보내는 모양: 검토(콘솔 · 검토자 MCP)와 되풀이 제안(콘솔)

/** 되풀이되는 일 제안 목록 (콘솔) */
export class SuggestionListView {
  constructor(
    private readonly rows: readonly Readonly<SuggestionRow>[],
    private readonly siteNames: ReadonlyMap<string, string>,
  ) {}

  toJSON() {
    return {
      suggestions: this.rows.map((r) => ({
        id: r.id,
        siteId: r.site_id,
        siteName: this.siteNames.get(r.site_id) ?? '',
        count: r.count,
        sample: r.sample,
        version: r.version,
        lastSeenAt: r.last_seen_at.toISOString(),
      })),
    };
  }
}

/** 검토 하나 (콘솔): 버전 · 판정 · 의견 · 때 */
export function reviewJson(row: Readonly<IntegrationReviewRow> | null) {
  return row
    ? {
        seq: row.seq,
        verdict: row.verdict,
        notes: row.notes,
        createdAt: row.created_at.toISOString(),
      }
    : null;
}

/** site_review_get의 답 (검토자): 무엇을 검토하는지 */
export class ReviewMaterialView {
  constructor(
    private readonly material: {
      integrationId: string;
      name: string;
      title: string;
      description: string;
      mode: string;
      site: { name: string; origins: readonly string[] };
      seq: number;
      inputSchema: unknown;
      outputSchema: unknown;
      code: string;
      tests: unknown;
    },
  ) {}

  toJSON() {
    const m = this.material;
    return {
      integration_id: m.integrationId,
      name: m.name,
      title: m.title,
      description: m.description,
      mode: m.mode,
      site: m.site,
      seq: m.seq,
      input_schema: m.inputSchema,
      output_schema: m.outputSchema,
      code: m.code,
      tests: m.tests,
    };
  }
}

/** site_review의 답: 판정, 통과면 올릴 켜기 결재의 모양 */
export class ReviewSavedView {
  constructor(
    private readonly verdict: string,
    private readonly approval: {
      action: string;
      target_kind: string;
      target_id: string;
      target_version: number;
    } | null,
  ) {}

  toJSON() {
    return {
      verdict: this.verdict,
      ...(this.approval
        ? {
            next: 'request_approval로 아래 켜기 결재를 올리고 끝낸다',
            approval: this.approval,
          }
        : { next: '의견을 힌트로 다시 굳힌다 (끝낸다)' }),
    };
  }
}
