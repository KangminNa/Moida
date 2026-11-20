import type {
  EndpointRow,
  IntegrationRevisionRow,
  IntegrationRow,
  RunRow,
  SiteRow,
} from './tables';

// 사이트 도구(2026-11-16 MCP 2단계)가 내보내는 모양. 콘솔(관리자)은 camelCase, 에이전트 · 러너(MCP)는 snake_case.
// 코드와 시험은 콘솔의 상세와 러너(실행 · 굳히기)에만 싣는다. 에이전트는 이름 · 설명 · 입출력 형식만 본다

/** 콘솔 줄에 싣는 실행 답의 앞부분 */
const PREVIEW_MAX = 500;

function preview(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value).slice(0, PREVIEW_MAX);
}

/** 콘솔의 사이트 도구 한 줄 */
export class IntegrationView {
  constructor(
    private readonly row: Readonly<IntegrationRow>,
    private readonly siteName: string,
    /** 지금 버전의 검토 (쓰기 도구, reviewJson 모양) */
    private readonly review: unknown = null,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      siteId: r.site_id,
      siteName: this.siteName,
      name: r.name,
      title: r.title,
      description: r.description,
      hint: r.hint,
      status: r.status,
      mode: r.mode,
      reviewerId: r.reviewer_id,
      review: this.review,
      liveSeq: r.live_seq,
      draftSeq: r.draft_seq,
      failStreak: r.fail_streak,
      runsOk: r.runs_ok,
      runsFailed: r.runs_failed,
      lastRunAt: r.last_run_at?.toISOString() ?? null,
      lastError: r.last_error,
      version: r.version,
      updatedAt: r.updated_at.toISOString(),
    };
  }
}

/** 콘솔의 사이트 도구 목록 */
export class IntegrationListView {
  constructor(private readonly items: readonly IntegrationView[]) {}

  toJSON() {
    return { integrations: this.items.map((i) => i.toJSON()) };
  }
}

/** 콘솔의 상세: 도구, 최근 버전(코드 · 형식 · 시험 결과), 최근 실행 */
export class IntegrationDetailView {
  constructor(
    private readonly item: IntegrationView,
    private readonly revisions: readonly Readonly<IntegrationRevisionRow>[],
    private readonly runs: readonly Readonly<RunRow>[],
  ) {}

  toJSON() {
    return {
      integration: this.item.toJSON(),
      revisions: this.revisions.map((r) => ({
        seq: r.seq,
        passed: r.passed,
        total: r.total,
        inputSchema: r.input_schema,
        outputSchema: r.output_schema,
        code: r.code,
        tests: r.tests,
        createdAt: r.created_at.toISOString(),
      })),
      runs: this.runs.map((r) => ({
        id: r.id,
        version: r.version,
        seq: r.seq,
        status: r.status,
        input: preview(r.input),
        output: preview(r.output),
        error: r.error,
        errorKind: r.error_kind,
        ms: r.ms,
        createdAt: r.created_at.toISOString(),
      })),
    };
  }
}

/** site_tools의 답: 켜진 도구의 이름 · 설명 · 사이트 · 입출력 형식 */
export class SiteToolsView {
  constructor(
    private readonly tools: readonly {
      row: Readonly<IntegrationRow>;
      revision: Readonly<IntegrationRevisionRow>;
      site: string;
    }[],
  ) {}

  toJSON() {
    return {
      tools: this.tools.map(({ row, revision, site }) => ({
        name: row.name,
        title: row.title,
        description: row.description,
        mode: row.mode,
        site,
        input_schema: revision.input_schema,
        output_schema: revision.output_schema,
      })),
    };
  }
}

/** site_run · site_result의 답. 실패면 까닭과 대신할 길(browse로 맡기기) */
export class RunView {
  static readonly FALLBACK =
    '이 실행은 실패했어요. 같은 일을 브라우저 담당에게 browse 일로 맡겨요 (browser_sites의 사이트)';

  constructor(
    private readonly row: Readonly<RunRow>,
    /** 쓰기 실행이 결재를 기다리면(held) 올릴 결재의 모양 */
    private readonly approval: Readonly<Record<string, unknown>> | null = null,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      run_id: r.id,
      status: r.status,
      ...(this.approval
        ? {
            next: 'request_approval로 아래 결재를 올리고 끝낸다 (승인되면 서버가 한 번 돌린다)',
            approval: this.approval,
          }
        : {}),
      ...(r.status === 'done' ? { output: r.output } : {}),
      ...(r.status === 'failed'
        ? { error: r.error, error_kind: r.error_kind, fallback: RunView.FALLBACK }
        : {}),
      ...(r.status === 'dropped' || r.status === 'unknown' ? { error: r.error } : {}),
    };
  }
}

/** site_run_next의 답 (러너): 돌릴 코드 · 입력 · 사이트. 없으면 run: null */
export class NextRunView {
  constructor(
    private readonly next: {
      run: Readonly<RunRow>;
      revision: Readonly<IntegrationRevisionRow>;
      site: Readonly<SiteRow>;
      mode: string;
      timeoutMs: number;
    } | null,
  ) {}

  toJSON() {
    if (!this.next) return { run: null };
    const { run, revision, site, mode, timeoutMs } = this.next;
    return {
      run: {
        id: run.id,
        mode,
        input: run.input,
        code: revision.code,
        timeout_ms: timeoutMs,
        site: { id: site.id, name: site.name, start_url: site.start_url, origins: site.origins },
      },
    };
  }
}

/** site_run_save의 답 */
export class RunSavedView {
  constructor(
    private readonly runId: string,
    private readonly status: string,
  ) {}

  toJSON() {
    return { run_id: this.runId, status: this.status };
  }
}

/** site_build_save의 답: 받아들였는가(70% 이상), 버전, 켜기 결재에 쓸 도구의 판, 회차, 틀린 시험 */
export class BuildSavedView {
  constructor(
    private readonly saved: {
      accepted: boolean;
      seq: number;
      version: number;
      passed: number;
      total: number;
      /** 이 굳히기 작업이 남긴 버전 수 (러너가 몇 번째 회차인지 안다) */
      rounds: number;
      /** 쓰기 도구라 검토자에게 넘겼다 (러너는 켜기 결재를 올리지 않는다) */
      review: boolean;
      /** 읽기 도구라 바로 켰다 (2026-11-19, 러너는 켜기 결재를 올리지 않는다) */
      enabled: boolean;
      problems: readonly { name: string; problem: string }[];
    },
  ) {}

  toJSON() {
    const s = this.saved;
    return {
      accepted: s.accepted,
      seq: s.seq,
      integration_version: s.version,
      passed: s.passed,
      total: s.total,
      rounds: s.rounds,
      review: s.review,
      enabled: s.enabled,
      problems: s.problems,
    };
  }
}

/** browser_job의 굳히기 몫 (러너): 무엇을 굳히는지, 앞 버전(있으면), 최근 실패 */
export class BuildPartView {
  constructor(
    private readonly row: Readonly<IntegrationRow>,
    private readonly last: Readonly<IntegrationRevisionRow> | null,
    private readonly errors: readonly string[],
    /** 그 사이트에서 기록한 API의 모양 (B3, 화면 대신 site.api로 부를 재료) */
    private readonly apis: readonly Readonly<EndpointRow>[] = [],
  ) {}

  toJSON() {
    const { row, last } = this;
    return {
      integration_id: row.id,
      version: row.version,
      mode: row.mode,
      name: row.name,
      title: row.title,
      description: row.description,
      hint: row.hint,
      last: last
        ? {
            seq: last.seq,
            input_schema: last.input_schema,
            output_schema: last.output_schema,
            code: last.code,
            tests: last.tests,
          }
        : null,
      recent_errors: this.errors,
      endpoints: this.apis.map((e) => ({
        method: e.method,
        url: `${e.origin}${e.path}`,
        query: e.query,
        body: e.body,
        status: e.status,
        response: e.response,
        seen: e.seen,
      })),
    };
  }
}

/** browser_requests_save의 답: 남긴 수, API 도구를 굳히기 시작했는지 */
export class RequestsSavedView {
  constructor(
    private readonly saved: number,
    private readonly building: boolean,
  ) {}

  toJSON() {
    return { saved: this.saved, building: this.building };
  }
}
