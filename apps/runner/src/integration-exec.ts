import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CHILD_SOURCE, PAGE_MARK, RESULT_MARK } from './integration-child';
import { IntegrationRules } from './integration-rules';

/** 도구가 도는 사이트: 첫 주소와 이동해도 되는 출처 */
export type ExecSite = { startUrl: string; origins: readonly string[] };
/** 실행 하나의 끝. dry: 쓰기 도구의 마른 실행이 commit 앞에서 멈췄다. committed: 쓰기를 한 뒤에 실패했다 */
export type ExecOutcome =
  | { ok: true; output: Record<string, unknown>; ms: number; dry?: boolean }
  | {
      ok: false;
      error: string;
      kind: 'login' | 'timeout' | 'code';
      ms: number;
      committed?: boolean;
    };
/** 읽기 · 쓰기와 마른 실행 (2026-11-16 MCP 3단계) */
export type ExecMode = { mode: 'read' | 'write'; dryRun: boolean };

/**
 * 사이트 도구 코드 하나를 돌린다 (2026-11-16 MCP 2단계, AI 없음). 굳히기의 시험과 에이전트의 실행이 같은 길이다.
 * 규칙 검사(IntegrationRules)를 지난 코드만, 자식 프로세스에서 돌린다: 환경 변수는 비우고(러너의 토큰이 없다),
 * node의 권한 모델로 파일 읽기는 playwright-core와 일마다 만드는 빈 폴더만, 쓰기는 그 폴더만, 자식 프로세스 · worker는 막는다.
 * 네트워크는 막지 못한다: 탭의 문서 이동을 허용 출처로 묶고, 코드의 이름 규칙과 관리자 승인이 나머지를 맡는다 (OS 격리가 아니다).
 * 시간을 넘기면 자식을 끄고 연 탭을 CDP로 닫는다
 */
export class IntegrationExec {
  static readonly TIMEOUT_MS = 60_000;
  private static readonly OUTPUT_MAX = 300 * 1024;
  /** playwright-core가 불러올 때 읽는 시스템 경로 (WSL인지 본다) */
  private static readonly SYSTEM_READS = ['/proc/sys/fs/binfmt_misc/WSLInterop', '/run/WSL'];

  constructor(private readonly cdpUrl: string) {}

  /** 러너의 @playwright/mcp가 쓰는 playwright-core (따로 의존하지 않는다) */
  static playwrightCore(): string {
    const mcp = createRequire(__filename).resolve('@playwright/mcp/package.json');
    return dirname(createRequire(mcp).resolve('playwright-core/package.json'));
  }

  async run(
    code: string,
    input: Readonly<Record<string, unknown>>,
    site: ExecSite,
    timeoutMs: number,
    signal: AbortSignal,
    how: ExecMode = { mode: 'read', dryRun: false },
  ): Promise<ExecOutcome> {
    const started = Date.now();
    const problems = IntegrationRules.problems(code, how.mode);
    if (problems.length > 0)
      return { ok: false, error: `규칙 검사: ${problems.join(' · ')}`, kind: 'code', ms: 0 };
    const playwright = await realpath(IntegrationExec.playwrightCore());
    const scratch = await mkdtemp(join(await realpath(tmpdir()), 'moida-site-'));
    try {
      const job = {
        code,
        input,
        origins: site.origins,
        startUrl: site.startUrl,
        playwright,
        mode: how.mode,
        dryRun: how.dryRun,
      };
      const { text, timedOut, tooBig } = await this.spawn(
        job,
        playwright,
        scratch,
        timeoutMs,
        signal,
      );
      const ms = Date.now() - started;
      if (timedOut) {
        await this.closePage(text);
        const why = signal.aborted
          ? '러너가 멈춰요'
          : `${Math.round(timeoutMs / 1000)}초 안에 끝나지 않았어요`;
        return { ok: false, error: why, kind: 'timeout', ms };
      }
      if (tooBig) {
        await this.closePage(text);
        return { ok: false, error: '답이 너무 커요', kind: 'code', ms };
      }
      return IntegrationExec.outcomeOf(text, ms);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  private spawn(
    job: object,
    playwright: string,
    scratch: string,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<{ text: string; timedOut: boolean; tooBig: boolean }> {
    const reads = [playwright, scratch, ...IntegrationExec.SYSTEM_READS];
    const child = spawn(
      process.execPath,
      [
        '--permission',
        ...reads.map((path) => `--allow-fs-read=${path}`),
        `--allow-fs-write=${scratch}`,
        '-e',
        CHILD_SOURCE,
      ],
      { env: { TMPDIR: scratch }, stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    let tooBig = false;
    const kill = () => {
      timedOut = !tooBig;
      child.kill('SIGKILL');
    };
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= IntegrationExec.OUTPUT_MAX) chunks.push(chunk);
      else if (!tooBig) {
        tooBig = true;
        child.kill('SIGKILL');
      }
    });
    const timer = setTimeout(kill, timeoutMs);
    signal.addEventListener('abort', kill, { once: true });
    child.stdin.end(JSON.stringify({ ...job, cdp: this.cdpUrl }));
    return new Promise((done) => {
      child.once('close', () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', kill);
        done({ text: Buffer.concat(chunks).toString('utf8'), timedOut, tooBig });
      });
    });
  }

  /** 자식이 끝내지 못하고 꺼졌으면 연 탭을 닫는다 (지금 브라우저에 탭이 쌓이지 않게) */
  private async closePage(text: string): Promise<void> {
    const line = text.split('\n').find((l) => l.startsWith(PAGE_MARK));
    const id = line?.slice(PAGE_MARK.length).trim();
    if (id && /^[A-Za-z0-9]{1,64}$/.test(id))
      await fetch(`${this.cdpUrl}/json/close/${id}`).catch(() => undefined);
  }

  /** 자식이 쓴 마지막 결과 줄 */
  static outcomeOf(text: string, ms: number): ExecOutcome {
    const line = text
      .split('\n')
      .filter((l) => l.startsWith(RESULT_MARK))
      .at(-1);
    if (!line) return { ok: false, error: '실행하지 못했어요 (결과가 없어요)', kind: 'code', ms };
    let body: {
      ok?: unknown;
      output?: unknown;
      error?: unknown;
      kind?: unknown;
      dry?: unknown;
      committed?: unknown;
    };
    try {
      body = JSON.parse(line.slice(RESULT_MARK.length));
    } catch {
      return { ok: false, error: '실행 결과를 읽지 못했어요', kind: 'code', ms };
    }
    if (body.ok === true) {
      const output = body.output;
      if (typeof output !== 'object' || output === null || Array.isArray(output))
        return { ok: false, error: '답은 객체여야 해요', kind: 'code', ms };
      return {
        ok: true,
        output: output as Record<string, unknown>,
        ms,
        ...(body.dry === true ? { dry: true } : {}),
      };
    }
    const said = typeof body.error === 'string' && body.error ? body.error : '실행하지 못했어요';
    const committed = body.committed === true;
    // 쓰기를 한 뒤의 실패는 됐을 수 있다: 까닭에 적어 관리자가 사이트에서 보게 한다
    const error = committed ? `commit 뒤에 실패했어요 (쓰기는 됐을 수 있어요): ${said}` : said;
    return { ok: false, error, kind: body.kind === 'login' ? 'login' : 'code', ms, committed };
  }
}
