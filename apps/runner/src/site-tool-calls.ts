import type { ApiCall } from './api-shape';
import type { ExecOutcome, ExecSite } from './integration-exec';
import type { Json } from './json';
import type { McpClient } from './mcp-client';

/** site_run_next로 꺼낸 실행 하나 */
export type QueuedRun = {
  id: string;
  /** 읽기 · 쓰기 (쓰기는 결재 뒤 한 번, commit에서만 보낸다) */
  mode: 'read' | 'write';
  code: string;
  input: Readonly<Record<string, unknown>>;
  timeoutMs: number;
  site: ExecSite & { name: string };
};

/** 굳히기의 시험 하나와 그 결과 */
export type BuildTest = {
  name: string;
  input: Readonly<Record<string, unknown>>;
  outcome: ExecOutcome;
};

/** site_build_save의 답 */
export type BuildVerdict = {
  accepted: boolean;
  seq: number;
  integrationVersion: number;
  passed: number;
  total: number;
  rounds: number;
  /** 쓰기 도구라 검토자에게 넘겼다 (러너는 켜기 결재를 올리지 않는다) */
  review: boolean;
  /** 읽기 도구라 서버가 바로 켰다 (2026-11-19, 러너는 켜기 결재를 올리지 않는다). 옛 서버면 false */
  enabled: boolean;
  problems: readonly string[];
};

/**
 * 사이트 도구의 러너 쪽 MCP 도구 (browser-tabs 0.5, 2026-11-16 MCP 2단계): 실행 꺼내기 · 남기기, 굳힌 결과 남기기.
 * 모양의 원본은 plugins/browser-tabs/moida-plugin.json의 tools다. 오류 글은 부르는 쪽이 지운 뒤 넘긴다
 */
export class SiteToolCalls {
  private static readonly ORIGIN = /^https?:\/\/[^/\s;]+$/i;

  constructor(private readonly mcp: McpClient) {}

  async nextRun(stop: AbortSignal): Promise<QueuedRun | null> {
    const body = await this.mcp.call('site_run_next', {}, 0, stop);
    if (!body.field('run')) return null;
    const run = body.child('run');
    const site = run.child('site');
    return {
      id: run.text('id'),
      mode: run.text('mode') === 'write' ? 'write' : 'read',
      code: run.text('code'),
      input: SiteToolCalls.record(run.field('input')),
      timeoutMs: run.number('timeout_ms'),
      site: {
        name: site.text('name'),
        startUrl: site.text('start_url'),
        origins: site.texts('origins').filter((o) => SiteToolCalls.ORIGIN.test(o)),
      },
    };
  }

  /**
   * 사이트 일에서 기록한 API 요청의 모양을 남긴다 (B2, browser-tabs 0.8). 서버가 API 사이트 도구를 만들기 시작했으면 building.
   * 그 작업의 임대를 쥔 러너만
   */
  async saveRequests(taskId: string, calls: readonly ApiCall[]): Promise<{ building: boolean }> {
    const body = await this.mcp.call('browser_requests_save', {
      task_id: taskId,
      requests: calls.map((c) => ({
        method: c.method,
        origin: c.origin,
        path: c.path,
        query: c.query,
        ...SiteToolCalls.shape('body', c.body),
        status: c.status,
        content_type: c.contentType,
        ...SiteToolCalls.shape('response', c.response),
      })),
    });
    return { building: body.flag('building') };
  }

  /** 모양 칸: JSON 글자 4,000자까지 (넘으면 빼고 보낸다: 자르면 JSON이 아니다) */
  private static shape(name: string, shape: unknown): Record<string, string> {
    if (shape === null) return {};
    const text = JSON.stringify(shape);
    return text.length <= 4_000 ? { [name]: text } : {};
  }

  async saveRun(id: string, outcome: ExecOutcome): Promise<void> {
    await this.mcp.call(
      'site_run_save',
      outcome.ok
        ? { run_id: id, status: 'done', output: outcome.output, ms: outcome.ms }
        : {
            run_id: id,
            status: 'failed',
            error: outcome.error.slice(0, 500),
            error_kind: outcome.kind,
            ms: outcome.ms,
          },
    );
  }

  async saveBuild(
    taskId: string,
    tool: { inputSchema: unknown; outputSchema: unknown; code: string },
    tests: readonly BuildTest[],
  ): Promise<BuildVerdict> {
    const body: Json = await this.mcp.call('site_build_save', {
      task_id: taskId,
      input_schema: tool.inputSchema,
      output_schema: tool.outputSchema,
      code: tool.code,
      tests: tests.map((t) => ({
        name: t.name,
        input: t.input,
        ms: t.outcome.ms,
        ...(t.outcome.ok ? { output: t.outcome.output } : { error: t.outcome.error.slice(0, 500) }),
      })),
    });
    return {
      accepted: body.flag('accepted'),
      seq: body.number('seq'),
      integrationVersion: body.number('integration_version'),
      passed: body.number('passed'),
      total: body.number('total'),
      rounds: body.number('rounds'),
      review: body.flag('review'),
      enabled: body.flag('enabled'),
      problems: body.list('problems').map((p) => `${p.text('name')}: ${p.text('problem')}`),
    };
  }

  private static record(value: unknown): Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
