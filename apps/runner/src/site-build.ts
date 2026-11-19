import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowseSite } from './browse-job';
import type { AskedApproval } from './browse-login';
import type { IntegrationExec } from './integration-exec';
import type { Json } from './json';
import { ServerUnreachable, ToolRefused } from './mcp-client';
import { RunEvent, RunResult } from './progress';
import type { PromptPack } from './prompt-pack';
import type { Redactor } from './redactor';
import { RunEnding } from './run-ending';
import type { BuildTest, SiteToolCalls } from './site-tool-calls';

/** browser_job의 build: 굳힐 도구, 앞 버전, 최근 실패 */
export class SiteBuildPlan {
  private constructor(
    readonly integrationId: string,
    /** 읽기 · 쓰기 (2026-11-16 MCP 3단계): 쓰기면 시험은 마른 실행, 통과하면 검토자에게 */
    readonly mode: 'read' | 'write',
    readonly name: string,
    readonly title: string,
    readonly description: string,
    /** 앞 버전 (고치기 · 다음 회차의 힌트). 처음이면 null */
    readonly last: string | null,
    readonly errors: readonly string[],
  ) {}

  /** build 칸이 없거나 비면 null (보통 사이트 일) */
  static from(body: Json): SiteBuildPlan | null {
    if (!body.field('build')) return null;
    const build = body.child('build');
    const last = build.field('last') ? build.child('last') : null;
    return new SiteBuildPlan(
      build.text('integration_id'),
      build.text('mode') === 'write' ? 'write' : 'read',
      build.text('name'),
      build.text('title'),
      build.text('description'),
      last ? SiteBuildPlan.lastOf(last) : null,
      build.texts('recent_errors').slice(0, 5),
    );
  }

  /** 앞 버전을 지시문에 싣는 글: 형식 · 코드 · 틀린 시험 */
  private static lastOf(last: Json): string {
    const failed = last
      .list('tests')
      .filter((t) => !t.flag('ok'))
      .map((t) => `- ${t.text('name')}: ${t.text('problem')}`);
    return [
      `버전 ${last.number('seq')}`,
      '```json',
      JSON.stringify(
        { input_schema: last.field('input_schema'), output_schema: last.field('output_schema') },
        null,
        2,
      ),
      '```',
      '```js',
      last.text('code').slice(0, 8000),
      '```',
      failed.length > 0
        ? `틀린 시험:\n${failed.join('\n')}`
        : '시험은 모두 통과했어요 (최근 실행의 실패를 고쳐요)',
    ].join('\n');
  }
}

/**
 * 사이트 도구 굳히기의 뒤 (2026-11-16 MCP 2단계, docs/MCP.md 6장). AI(Claude)가 Playwright MCP로 사이트를 둘러보고
 * 작업 폴더의 site-tool/에 tool.json(입출력 형식) · code.js(본문) · tests.json(시험 3~10개)을 남기면, 러너가 시험을 하나씩
 * 직접 돌려(IntegrationExec, AI 없음) site_build_save로 보낸다. 서버가 채점해 70% 이상이면 읽기 도구는 서버가 바로 켜고(2026-11-19) 그 밖은 켜기 결재를 올리고,
 * 아니면 첫 회차는 일을 돌려줘(다음 회차가 틀린 시험을 힌트로 받는다) 한 번 더, 두 번째도 못 넘으면 실패로 끝낸다
 */
export class SiteBuild {
  static readonly ACTION = 'browser.integration.enable';
  static readonly DIR = 'site-tool';
  private static readonly ROUNDS = 2;
  private static readonly TEST_MS = 45_000;
  private static readonly TESTS_MAX = 10;

  constructor(
    private readonly calls: SiteToolCalls,
    private readonly exec: IntegrationExec,
    private readonly taskId: string,
  ) {}

  /** 지시문 틀 site-build를 채운 단락 */
  static part(prompts: PromptPack, plan: SiteBuildPlan): string {
    return prompts.fill('site-build', {
      name: plan.name,
      title: plan.title,
      description: plan.description,
      write: plan.mode === 'write',
      last: plan.last,
      errors: plan.errors.map((e) => `- ${e}`).join('\n') || null,
    });
  }

  async finish(
    plan: SiteBuildPlan,
    site: BrowseSite,
    workDir: string,
    signal: AbortSignal,
    note: (event: RunEvent) => void,
    redactor: Redactor,
  ): Promise<{ ending: RunEnding; approval: AskedApproval | null }> {
    const failed = (error: string) => ({
      ending: RunEnding.submit(error, RunResult.failed(error, redactor)),
      approval: null,
    });
    const files = await SiteBuild.read(join(workDir, SiteBuild.DIR));
    if (typeof files === 'string') return failed(`굳힌 파일을 읽지 못했어요: ${files}`);
    const tests: BuildTest[] = [];
    for (const test of files.tests) {
      if (signal.aborted) return { ending: RunEnding.release('러너가 멈춰요'), approval: null };
      const raw = await this.exec.run(files.code, test.input, site, SiteBuild.TEST_MS, signal, {
        mode: plan.mode,
        dryRun: plan.mode === 'write',
      });
      const outcome = raw.ok ? raw : { ...raw, error: redactor.clean(raw.error) };
      note(
        new RunEvent(
          outcome.ok ? RunEvent.READ : RunEvent.ERROR,
          `시험 ${test.name}: ${outcome.ok ? '답을 받았어요' : outcome.error}`,
          0,
        ),
      );
      tests.push({ ...test, outcome });
    }
    let verdict: Awaited<ReturnType<SiteToolCalls['saveBuild']>>;
    try {
      verdict = await this.calls.saveBuild(this.taskId, files, tests);
    } catch (error) {
      if (!(error instanceof ToolRefused || error instanceof ServerUnreachable)) throw error;
      return failed(`굳힌 결과를 남기지 못했어요: ${error.message}`);
    }
    const score = `시험 ${verdict.passed}/${verdict.total} 통과`;
    if (verdict.accepted && verdict.review) {
      const summary = `${plan.title} (${plan.name}, 쓰기) 버전 ${verdict.seq}: ${score} (마른 실행). 검토자에게 넘겼어요`;
      return {
        ending: RunEnding.submit('끝났어요', RunResult.done(summary, redactor)),
        approval: null,
      };
    }
    if (verdict.accepted && verdict.enabled) {
      const summary = `${plan.title} (${plan.name}) 버전 ${verdict.seq}: ${score}. 바로 켰어요 (읽기 도구)`;
      return {
        ending: RunEnding.submit('끝났어요', RunResult.done(summary, redactor)),
        approval: null,
      };
    }
    if (verdict.accepted) {
      const summary = `${plan.title} (${plan.name}) 버전 ${verdict.seq}: ${score}. 켜기 승인을 올려요`;
      return {
        ending: RunEnding.submit('끝났어요', RunResult.done(summary, redactor)),
        approval: {
          requestId: `browser-integration:${plan.integrationId}:${verdict.seq}`,
          action: SiteBuild.ACTION,
          targetKind: 'browser_integration',
          targetId: plan.integrationId,
          targetVersion: verdict.integrationVersion,
          note: `사이트 도구 ${plan.name} 버전 ${verdict.seq} · ${score}`,
        },
      };
    }
    const why = `${score} (70% 미만): ${verdict.problems.slice(0, 3).join(' · ')}`;
    if (verdict.rounds < SiteBuild.ROUNDS)
      return { ending: RunEnding.release(`${why}. 고쳐서 한 번 더 해요`), approval: null };
    return failed(why);
  }

  /** site-tool/의 세 파일. 틀리면 까닭 (형식의 뜻은 서버가 본다) */
  static async read(dir: string): Promise<
    | string
    | {
        inputSchema: unknown;
        outputSchema: unknown;
        code: string;
        tests: { name: string; input: Readonly<Record<string, unknown>> }[];
      }
  > {
    const text = (name: string) => readFile(join(dir, name), 'utf8').catch(() => null);
    const [tool, code, tests] = await Promise.all([
      text('tool.json'),
      text('code.js'),
      text('tests.json'),
    ]);
    if (tool === null || code === null || tests === null)
      return 'site-tool/에 tool.json · code.js · tests.json이 모두 있어야 해요';
    let parsed: { tool: unknown; tests: unknown };
    try {
      parsed = { tool: JSON.parse(tool), tests: JSON.parse(tests) };
    } catch {
      return 'tool.json · tests.json이 JSON이 아니에요';
    }
    const shapes = parsed.tool as { input_schema?: unknown; output_schema?: unknown } | null;
    if (!shapes?.input_schema || !shapes.output_schema)
      return 'tool.json에는 input_schema와 output_schema가 있어야 해요';
    const list = Array.isArray(parsed.tests) ? parsed.tests : [];
    const cases = list.slice(0, SiteBuild.TESTS_MAX).flatMap((t, i) => {
      const { name, input } = (t ?? {}) as { name?: unknown; input?: unknown };
      if (typeof input !== 'object' || input === null || Array.isArray(input)) return [];
      const label =
        typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : `시험 ${i + 1}`;
      return [{ name: label, input: input as Record<string, unknown> }];
    });
    if (cases.length < 3) return 'tests.json에 입력이 있는 시험이 3개 이상 있어야 해요';
    return {
      inputSchema: shapes.input_schema,
      outputSchema: shapes.output_schema,
      code,
      tests: cases,
    };
  }
}
