import { Backoff, pause } from './backoff';
import type { BrowserSlot } from './browser-slot';
import type { IntegrationExec } from './integration-exec';
import { AccessDenied, ServerUnreachable, ToolRefused } from './mcp-client';
import type { Redactor, RunLog } from './redactor';
import type { QueuedRun, SiteToolCalls } from './site-tool-calls';

// 사이트 도구 실행의 러너 쪽 (2026-11-16 MCP 2단계). 서버 브라우저가 있는 러너만 돈다. 작업 대기열과 따로 돈다 (탭 읽기 · 결재된
// 클릭과 같은 길): 에이전트가 site_run으로 맡긴 실행을 site_run_next로 하나 꺼내, 브라우저 자리(BrowserSlot)를 잡고
// AI 없이 코드를 돌려(IntegrationExec) site_run_save로 남긴다. 로그에는 실행 id와 사이트 이름만 남긴다
export class IntegrationRunner {
  /** 꺼낼 것이 없을 때 다시 묻는 간격 */
  static readonly IDLE_MS = 2_000;
  /** 패키지가 꺼져 있거나 옛 패키지일 때 (도구가 없을 때) 다시 묻는 간격 */
  static readonly OFF_MS = 300_000;
  private static readonly SAVE_TRIES = 5;
  private readonly backoff = new Backoff(5_000, 300_000);
  private off = false;

  constructor(
    private readonly calls: SiteToolCalls,
    private readonly exec: IntegrationExec,
    private readonly slot: BrowserSlot,
    private readonly log: RunLog,
    private readonly redactor: Redactor,
  ) {}

  /** stop까지 돈다. 토큰이 거절되면 AccessDenied를 그대로 던진다 (러너가 다시 연결한다) */
  async run(stop: AbortSignal): Promise<void> {
    while (!stop.aborted) {
      try {
        const run = await this.calls.nextRun(stop);
        if (this.off) this.log.info('사이트 도구 실행을 다시 받아요');
        this.off = false;
        this.backoff.reset();
        if (run) await this.perform(run, stop);
        else await pause(IntegrationRunner.IDLE_MS, stop);
      } catch (error) {
        if (stop.aborted) break;
        if (error instanceof AccessDenied) throw error;
        if (error instanceof ToolRefused && /도구가 없어요/.test(error.message)) {
          if (!this.off)
            this.log.info('브라우저 탭 패키지(0.5)가 꺼져 있어 사이트 도구를 받지 않아요');
          this.off = true;
          await pause(IntegrationRunner.OFF_MS, stop);
          continue;
        }
        this.log.info(`사이트 도구: 다시 시도해요: ${(error as Error).message}`);
        await this.backoff.wait(stop);
      }
    }
  }

  /** 자리를 잡고 돌린 뒤 남긴다. 남기지 못하면 서버가 90초 뒤 다시 줄을 세운다 */
  private async perform(run: QueuedRun, stop: AbortSignal): Promise<void> {
    const free = await this.slot.take(stop);
    if (free === null) return;
    let outcome: Awaited<ReturnType<IntegrationExec['run']>>;
    try {
      outcome = await this.exec.run(run.code, run.input, run.site, run.timeoutMs, stop);
    } finally {
      free();
    }
    const clean = outcome.ok ? outcome : { ...outcome, error: this.redactor.clean(outcome.error) };
    this.log.info(
      `사이트 도구 실행 ${run.id} (${run.site.name}): ${clean.ok ? '끝났어요' : clean.kind}`,
    );
    for (let tries = 1; ; tries++) {
      try {
        await this.calls.saveRun(run.id, clean);
        return;
      } catch (error) {
        const retry = error instanceof ServerUnreachable && tries < IntegrationRunner.SAVE_TRIES;
        if (!retry || stop.aborted) throw error;
        await this.backoff.wait(stop);
      }
    }
  }
}
