import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { IntegrationRules } from './integration-rules';

/** 도구가 도는 사이트: 첫 주소와 이동해도 되는 출처 */
export type ExecSite = { startUrl: string; origins: readonly string[] };
/** 실행 하나의 끝 */
export type ExecOutcome =
  | { ok: true; output: Record<string, unknown>; ms: number }
  | { ok: false; error: string; kind: 'login' | 'timeout' | 'code'; ms: number };

/** 자식 프로세스의 표시: 결과 · 연 탭 (stdout의 다른 글과 섞이지 않게) */
const RESULT = '@@cairn-site-result@@';
const PAGE = '@@cairn-site-page@@';

// 자식 프로세스에서 도는 코드 (CommonJS, -e로 넘긴다: 러너의 TS 등록 없이 돈다). 표준 입력으로 일을 받는다.
// 지금 브라우저(CDP)의 기본 컨텍스트(유지 로그인)에 새 탭 하나를 열고, 그 탭의 문서 이동은 허용 출처의 GET만 둔다(읽기).
// 도구 코드는 vm의 빈 맥락에서 page · input · site만 받아 돈다. 끝나면 탭을 닫고 결과 한 줄을 쓴다
const CHILD = `
const vm = require('node:vm');
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  const job = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const send = (m) => process.stdout.write('\\n${RESULT}' + JSON.stringify(m) + '\\n');
  let browser = null;
  let page = null;
  try {
    const { chromium } = require(job.playwright);
    browser = await chromium.connectOverCDP(job.cdp, { timeout: 10000 });
    const context = browser.contexts()[0] || (await browser.newContext());
    page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const info = await cdp.send('Target.getTargetInfo');
    await cdp.detach();
    process.stdout.write('\\n${PAGE}' + info.targetInfo.targetId + '\\n');
    const allowed = new Set(job.origins);
    await page.route('**/*', (route) => {
      const r = route.request();
      if (r.isNavigationRequest() && r.frame() === page.mainFrame()) {
        let origin = '';
        try { origin = new URL(r.url()).origin; } catch {}
        if (!allowed.has(origin) || r.method() !== 'GET') return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    const site = Object.freeze({
      origin: new URL(job.startUrl).origin,
      start_url: job.startUrl,
      loginNeeded: (why) => {
        const e = new Error(String(why || '로그인이 필요해요'));
        e.cairnLogin = true;
        throw e;
      },
    });
    const run = vm.runInNewContext('(async ({ page, input, site }) => {\\n' + job.code + '\\n})', Object.create(null), { timeout: 1000 });
    const output = await run({ page, input: job.input, site });
    send({ ok: true, output });
  } catch (e) {
    const message = String((e && e.message) || e).split('\\n')[0].slice(0, 500);
    send({ ok: false, error: message, kind: e && e.cairnLogin ? 'login' : 'code' });
  } finally {
    try { if (page) await page.close(); } catch {}
    try { if (browser) await browser.close(); } catch {}
    process.exit(0);
  }
});
`;

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
  ): Promise<ExecOutcome> {
    const started = Date.now();
    const problems = IntegrationRules.problems(code);
    if (problems.length > 0)
      return { ok: false, error: `규칙 검사: ${problems.join(' · ')}`, kind: 'code', ms: 0 };
    const playwright = await realpath(IntegrationExec.playwrightCore());
    const scratch = await mkdtemp(join(await realpath(tmpdir()), 'cairn-site-'));
    try {
      const job = { code, input, origins: site.origins, startUrl: site.startUrl, playwright };
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
        CHILD,
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
    const line = text.split('\n').find((l) => l.startsWith(PAGE));
    const id = line?.slice(PAGE.length).trim();
    if (id && /^[A-Za-z0-9]{1,64}$/.test(id))
      await fetch(`${this.cdpUrl}/json/close/${id}`).catch(() => undefined);
  }

  /** 자식이 쓴 마지막 결과 줄 */
  static outcomeOf(text: string, ms: number): ExecOutcome {
    const line = text
      .split('\n')
      .filter((l) => l.startsWith(RESULT))
      .at(-1);
    if (!line) return { ok: false, error: '실행하지 못했어요 (결과가 없어요)', kind: 'code', ms };
    let body: { ok?: unknown; output?: unknown; error?: unknown; kind?: unknown };
    try {
      body = JSON.parse(line.slice(RESULT.length));
    } catch {
      return { ok: false, error: '실행 결과를 읽지 못했어요', kind: 'code', ms };
    }
    if (body.ok === true) {
      const output = body.output;
      if (typeof output !== 'object' || output === null || Array.isArray(output))
        return { ok: false, error: '답은 객체여야 해요', kind: 'code', ms };
      return { ok: true, output: output as Record<string, unknown>, ms };
    }
    const error = typeof body.error === 'string' && body.error ? body.error : '실행하지 못했어요';
    return { ok: false, error, kind: body.kind === 'login' ? 'login' : 'code', ms };
  }
}
