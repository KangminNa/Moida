import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowseJob } from './browse-job';
import { type AskedApproval, BrowseLogin } from './browse-login';
import { BrowsePlan } from './browser-mcp';
import { BrowserPages, type BrowserTab } from './browser-page';
import type { BrowserSlot } from './browser-slot';
import { BrowserStop, BrowserStopProblem } from './browser-stop';
import { BrowserUnavailable } from './browser-tabs';
import { ExploreProxy } from './explore-proxy';
import { IntegrationExec } from './integration-exec';
import type { Job } from './job';
import type { LoginFormRef } from './login-form-ref';
import { McpClient, ServerUnreachable, ToolRefused } from './mcp-client';
import { MoidaServer } from './moida-server';
import { NetworkTap } from './network-tap';
import { PressLoop } from './press-loop';
import { RunEvent, RunResult } from './progress';
import type { PromptPack } from './prompt-pack';
import type { Redactor } from './redactor';
import { RunEnding } from './run-ending';
import type { RunnerConfig } from './runner-config';
import type { SandboxStage } from './sandbox-stage';
import { SiteBuild } from './site-build';
import type { StageCheck } from './stage-check';
import { StepShots } from './step-shots';
import { StopHold } from './stop-hold';

type Note = (event: RunEvent) => void;

// 브라우저 작업(browse)의 앞뒤 (2차 3단계 서버 브라우저 목표, 2026-11-14). AI는 Playwright MCP로 채우기까지만 하고,
// 마지막 버튼 · 로그인은 러너(AI 없음)가 한다.
//   앞: browser_job으로 어디서 돌지 받는다. 둘러보기면 내부 주소를 막는 프록시를 띄우고(ExploreProxy) 여럿이 함께 돈다.
//       사이트 일이면 브라우저 자리(BrowserSlot)를 잡고 지금 탭을 기억한다. 로그인이 필요하다고 적혀 있으면 AI 없이 로그인 결재로
//   뒤: AI가 단계마다 찍은 화면을 올린다(browser_shot_save). browser-stop.json이 있으면
//       final_click → 그 탭에서 버튼을 다시 찾아 지문 · 화면과 함께 붙잡고(browser_click_hold) 클릭 결재를 올린다
//       login → 로그인 화면을 남기고(browser_login_needed) 로그인 결재를 올린다 ("로그인했어요"면 같은 작업이 처음부터 이어서)
//       click_plan → 누르기 계획을 붙잡고(browser_click_plan) 계획 결재를 올린다. 승인되면 같은 작업이 이어서 돌고, 그 실행에서는
//       AI가 browser_press로 요청한 버튼을 PressLoop가 다시 찾아 누른다 (F2, 2026-11-21)
// 결재는 AI가 아니라 러너가 올린다: 지문과 화면이 있어야 승인 뒤에 "같은 버튼"을 확인할 수 있다 (ClickRunner가 누른다).
export class BrowseStage implements SandboxStage {
  private static readonly STOPPING = '러너가 멈춰요';

  readonly workspaceRoom = null;
  readonly needsOutputs = false;
  unreachable = false;
  private plan: BrowseJob | null = null;
  /** 이 일의 자리 (단계 화면 폴더) */
  private dir: string | null = null;
  private proxy: ExploreProxy | null = null;
  /** 잡은 브라우저 자리를 놓는다 (사이트 일만) */
  private free: (() => void) | null = null;
  /** AI가 뜨기 전에 열려 있던 탭: AI가 새로 연 탭을 먼저 본다 */
  private before = new Set<string>();
  /** 요청 기록 (B2): 사이트 일 동안 그 사이트로 가는 API 요청의 모양 */
  private tap: NetworkTap | null = null;
  /** 승인된 누르기 계획이 있는 실행에서 AI가 요청한 버튼을 누르는 고리 */
  private presses: PressLoop | null = null;
  private approval: AskedApproval | null = null;
  private readonly login: BrowseLogin;

  constructor(
    private readonly job: Job,
    private readonly config: RunnerConfig,
    private readonly server: MoidaServer,
    private readonly slot: BrowserSlot,
    private readonly pages: BrowserPages,
  ) {
    this.login = new BrowseLogin(server, pages, job.taskId);
  }

  /** 결과 뒤에 올릴 결재가 있는가 (클릭 · 로그인) */
  get awaitsApproval(): boolean {
    return this.approval !== null;
  }

  async prepare(signal: AbortSignal, note: Note, redactor: Redactor): Promise<RunEnding | null> {
    const failed = (error: string) => RunEnding.submit(error, RunResult.failed(error, redactor));
    try {
      this.plan = await this.server.browserJob(this.job.taskId, signal);
    } catch (error) {
      if (signal.aborted) return RunEnding.release(BrowseStage.STOPPING);
      // 도구가 없으면 browser-tabs 플러그인이 동작하지 않는 것이다 (서버가 맡기기 전에 막지만, 그 전에 쌓인 일은 여기로 온다)
      if (error instanceof ToolRefused)
        return failed(
          `어디서 일할지 받지 못했어요: ${error.message}${error.message.includes('도구가 없어요') ? '. 설정 › 플러그인에서 browser-tabs를 켜 주세요' : ''}`,
        );
      if (!(error instanceof ServerUnreachable)) throw error;
      this.unreachable = true;
      return RunEnding.release(`서버에 닿지 못해 돌려줘요: ${error.message}`);
    }
    this.dir = await mkdtemp(join(await realpath(tmpdir()), 'moida-browse-'));
    await mkdir(join(this.dir, 'steps'));
    const { site } = this.plan;
    if (site === null) {
      this.proxy = await ExploreProxy.start();
      note(
        new RunEvent(
          RunEvent.READ,
          '둘러보기: 로그인 없는 새 창으로 열어요 (내부 주소는 막혀요)',
          0,
        ),
      );
      return null;
    }
    this.free = await this.slot.take(signal);
    if (this.free === null) return RunEnding.release(BrowseStage.STOPPING);
    note(new RunEvent(RunEvent.READ, `사이트: ${site.name}`, 0));
    try {
      const tabs = await this.pages.tabs(signal);
      this.before = new Set(tabs.map((t) => t.id));
      if (!this.plan.loginNeeded) {
        this.tap = new NetworkTap(this.pages, site.origins);
        this.tap.start();
        if (this.plan.clickPlan) {
          const tabOf = (url: string, s: AbortSignal) => this.tabOf(url, s);
          this.presses = new PressLoop(
            this.server.presses,
            this.pages,
            this.job.taskId,
            tabOf,
            note,
          );
          this.presses.start(signal);
        }
        return null;
      }
      // 로그인이 풀려 있다고 적혀 있다: AI를 띄우지 않고 로그인 결재를 바로 올린다 (관리자가 로그인할 탭을 열어 둔다)
      const tab = await this.login.tab(site.startUrl, site.origins, signal);
      const url = tab.url || site.startUrl;
      const ending = await this.needLogin(url, tab, signal, note, redactor);
      const asked = ending ?? (await this.requestApproval(signal, redactor));
      return asked ?? RunEnding.quiet('로그인이 필요해 결재를 올렸어요');
    } catch (error) {
      if (!(error instanceof BrowserUnavailable)) throw error;
      this.unreachable = true;
      return RunEnding.release(`브라우저에 닿지 못해 돌려줘요: ${error.message}`);
    }
  }

  /** AI에게 줄 일: 사이트 · 둘러보기 단락(지시문 틀 site)과 Playwright MCP를 띄울 자리 */
  aiJob(prompts: PromptPack): Job {
    const { plan, dir } = this;
    if (plan === null || dir === null) return this.job;
    const site = plan.site;
    const part = prompts.fill('site', {
      explore: site === null,
      name: site?.name ?? null,
      start: site?.startUrl ?? null,
      origins: site?.origins.join(', ') ?? null,
      held: plan.held?.pageUrl ?? null,
      plan: plan.clickPlan?.summary ?? null,
      left: plan.clickPlan?.left ?? null,
    });
    const browse = new BrowsePlan(site?.origins ?? [], join(dir, 'steps'), this.proxy?.url ?? null);
    const build = plan.build ? `\n\n${SiteBuild.part(prompts, plan.build)}` : '';
    return this.job.withBrowse(browse, part + build);
  }

  /** 하네스의 검사가 없다 (사이트 도구 굳히기의 시험은 finish에서 SiteBuild가) */
  async check(): Promise<StageCheck[]> {
    return [];
  }

  async finish(
    summary: string,
    _checks: readonly StageCheck[],
    signal: AbortSignal,
    note: Note,
    redactor: Redactor,
    workDir = '',
  ): Promise<RunEnding> {
    const failed = (error: string) => RunEnding.submit(error, RunResult.failed(error, redactor));
    await this.presses?.stop();
    this.presses = null;
    if (this.dir)
      await new StepShots(this.server, this.job.taskId).ship(join(this.dir, 'steps'), signal, note);
    await this.shipRequests(note);
    // 사이트 도구 굳히기: 남긴 파일로 시험을 돌려 채점받는다. 통과하면 읽기 도구는 서버가 바로 켜고, 그 밖은 켜기 결재 (SiteBuild)
    if (this.plan?.build && this.plan.site) {
      const exec = new IntegrationExec(this.config.browserUrl ?? '');
      const build = new SiteBuild(this.server.siteTools, exec, this.job.taskId);
      const built = await build.finish(
        this.plan.build,
        this.plan.site,
        workDir,
        signal,
        note,
        redactor,
      );
      this.approval = built.approval;
      return built.ending;
    }
    const done = RunEnding.submit('끝났어요', RunResult.done(summary, redactor));
    let stop: BrowserStop | null;
    try {
      stop = await BrowserStop.read(join(workDir, BrowserStop.FILE));
    } catch (error) {
      if (error instanceof BrowserStopProblem)
        return failed(`멈춘 자리를 읽지 못했어요: ${error.message}`);
      throw error;
    }
    const site = this.plan?.site ?? null;
    if (stop === null) return done;
    // 사람이 해야 하는 화면: 사이트 일이면 AI가 연 탭을, 둘러보기면 유지 프로필에 같은 주소를 열어 (등록 없이, 2026-11-19)
    if (stop.kind === 'login') {
      const origin = new URL(stop.pageUrl).origin;
      const tab = site
        ? await this.tabOf(stop.pageUrl, signal)
        : await this.login.tab(stop.pageUrl, [origin], signal).catch(() => null);
      const asked = this.needLogin(
        stop.pageUrl,
        tab,
        signal,
        note,
        redactor,
        stop.reason,
        stop.form,
      );
      return (await asked) ?? done;
    }
    if (site === null) {
      note(
        new RunEvent(RunEvent.ERROR, '둘러보기에서는 누르지 않아요 (멈춘 자리는 두고 끝내요)', 0),
      );
      return done;
    }
    const hold = new StopHold(this.server, this.pages, this.job.taskId);
    const held =
      stop.kind === 'click_plan'
        ? await hold.plan(stop)
        : await hold.finalClick(await this.tabOf(stop.pageUrl, signal), stop, signal);
    if ('error' in held) return failed(held.error);
    this.approval = held.approval;
    note(new RunEvent(RunEvent.WRITE, held.line, 0));
    return done;
  }

  /** 붙잡은 클릭 · 로그인 필요의 결재를 작업 토큰으로 올린다. 올리면 null, 못 올리면 실패로 끝낼 그 끝 */
  async requestApproval(signal: AbortSignal, redactor: Redactor): Promise<RunEnding | null> {
    const asked = this.approval;
    if (asked === null || signal.aborted) return null;
    const failed = (error: string) => RunEnding.submit(error, RunResult.failed(error, redactor));
    if (!this.job.runToken) return failed('작업 토큰이 없어 결재를 올리지 못했어요');
    const asAgent = new MoidaServer(new McpClient(this.config.mcpUrl, this.job.runToken));
    try {
      await asAgent.requestApproval(asked);
      return null;
    } catch (error) {
      if (!(error instanceof ToolRefused || error instanceof ServerUnreachable)) throw error;
      const hint =
        error instanceof ToolRefused
          ? ` (에이전트의 결재 동작에 ${asked.action}가 있어야 해요)`
          : '';
      return failed(`결재를 올리지 못했어요: ${error.message}${hint}`);
    }
  }

  async close(): Promise<void> {
    await this.presses?.stop();
    this.presses = null;
    this.tap?.stop();
    this.tap = null;
    this.free?.();
    this.free = null;
    await this.proxy?.close();
    this.proxy = null;
    if (this.dir) await rm(this.dir, { recursive: true, force: true });
  }

  /** 모은 요청 모양을 사이트에 남긴다 (서버가 API 사이트 도구를 만든다, B3). 남기지 못해도 일은 그대로 */
  private async shipRequests(note: Note): Promise<void> {
    const calls = this.tap?.stop() ?? [];
    this.tap = null;
    if (calls.length === 0) return;
    try {
      const saved = await this.server.siteTools.saveRequests(this.job.taskId, calls);
      const made = saved.building ? ' · API로 하는 사이트 도구를 만들어요' : '';
      note(new RunEvent(RunEvent.READ, `사이트의 API ${calls.length}개를 기록했어요${made}`, 0));
    } catch (error) {
      note(
        new RunEvent(RunEvent.ERROR, `API 기록을 남기지 못했어요: ${(error as Error).message}`, 0),
      );
    }
  }

  /** 로그인 화면을 남기고 로그인 결재를 준비한다 (BrowseLogin). 남기지 못하면 실패로 끝낼 그 끝 */
  private async needLogin(
    url: string,
    tab: BrowserTab | null,
    signal: AbortSignal,
    note: Note,
    redactor: Redactor,
    reason: string | null = null,
    form: LoginFormRef | null = null,
  ): Promise<RunEnding | null> {
    try {
      const asked = await this.login.need(url, tab, signal, reason, form);
      this.approval = asked.approval;
      const what = reason ? `확인이 필요해요(${reason})` : '로그인이 필요해요';
      const card = asked.card
        ? ' · 카드에 로그인 칸을 띄웠어요'
        : asked.problem
          ? ` · 로그인 칸은 쓰지 않아요 (${asked.problem})`
          : '';
      note(new RunEvent(RunEvent.WRITE, `${what}: ${asked.siteName}${card}`, 0));
      return null;
    } catch (error) {
      if (!(error instanceof ToolRefused || error instanceof ServerUnreachable)) throw error;
      const message = `로그인 필요를 남기지 못했어요: ${error.message}`;
      return RunEnding.submit(message, RunResult.failed(message, redactor));
    }
  }

  /** 멈춘 주소의 탭. AI가 새로 연 탭을 먼저, 없으면 같은 주소의 탭, 그래도 없고 새 탭이 하나뿐이면 그 탭 */
  private async tabOf(url: string, signal: AbortSignal): Promise<BrowserTab | null> {
    const tabs = await this.pages.tabs(signal).catch(() => []);
    const want = BrowserPages.withoutHash(url);
    const same = (t: BrowserTab) => BrowserPages.withoutHash(t.url) === want;
    const fresh = tabs.filter((t) => !this.before.has(t.id));
    return fresh.find(same) ?? tabs.find(same) ?? (fresh.length === 1 ? (fresh[0] ?? null) : null);
  }
}
