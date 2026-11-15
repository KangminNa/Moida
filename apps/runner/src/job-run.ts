import type { AiLogin } from './ai-login';
import type { AiProcess, ChildExit } from './ai-process';
import { type AiStream, type AiTool, AiTools } from './ai-tool';
import { Backoff, pause } from './backoff';
import type { CairnServer } from './cairn-server';
import type { Job } from './job';
import { JobWorkspace } from './job-workspace';
import { AccessDenied, ServerUnreachable, ToolRefused } from './mcp-client';
import { OutputBatch } from './output-batch';
import { OutputUploader } from './output-uploader';
import { ProgressState, RunEvent, RunResult } from './progress';
import { ProgressReporter } from './progress-reporter';
import { PromptPack } from './prompt-pack';
import type { Redactor, RunLog } from './redactor';
import { RunEnding } from './run-ending';
import type { RunnerConfig } from './runner-config';
import type { SandboxStage } from './sandbox-stage';
import { StageCheck } from './stage-check';

/** AI CLI를 실행조차 못 함. 일마다 똑같이 실패할 테니 러너를 멈춘다 */
export class CliUnavailable extends Error {}

// 일 하나의 처음부터 끝까지: 자리를 만들고, AI CLI를 띄우고, 기록을 보내며 서버의 답을 보고, 끝을 알리고, 자리를 지운다.
//
// 서버의 답 (report_progress):
//   cancelled     → 끄고 끝. 주인이 멈췄으니 제출하지 않는다
//   waiting       → 끄고 끝. 에이전트가 결재를 올렸으니 제출하지 않는다 (서버는 waiting에 대한 제출을 거절한다)
//   paused        → 끄고 돌려준다 (release_job). 에이전트가 다시 움직이면 다른 실행이 맡는다
//   거절           → 끄고 끝. 임대를 잃었으니 이 일은 이제 이 러너의 것이 아니다
// AI CLI가 스스로 끝나면 남은 기록을 먼저 보내고 답을 본 뒤 제출한다: 결재를 올리자마자 끝난 실행을 done으로 보내면 안 된다.
// 칸의 일(stage)은 AI 앞뒤가 더 있다: 코드 작업은 clone · setup과 checks · push, 만들기 작업은 재료 받기와 프로세스 끄기.
// 그동안에도 같은 고리로 보고해 임대를 늘리고 취소를 듣는다.
// 검증 고리 V: AI가 잘 끝난 뒤 칸의 검사(stage.check)에 떨어지면 같은 작업 폴더에서 AI CLI를 한 번 더 띄워
// 떨어진 출력을 보이고(틀 check-fix) 다시 검사한 뒤 끝낸다. 마지막 검사는 결과(result.checks)에 싣는다.
export class JobRun {
  private static readonly REPORT_MS = 3_000;
  private static readonly RETRY_FIRST_MS = 1_000;
  private static readonly RETRY_MAX_MS = 30_000;
  /** 멈추는 중에는 서버가 답하지 않아도 이만큼만 더 시도한다 */
  private static readonly STOP_RETRY_MS = 5_000;
  private static readonly STOPPING = '러너가 멈춰요';
  private static readonly PAUSED = '에이전트가 멈췄어요';
  /** 검사에 떨어졌을 때 AI에게 더 맡기는 횟수 (일 하나에 한 번: 고치지 못하는 일에 구독을 계속 쓰지 않게) */
  private static readonly CHECK_RETRIES = 1;

  private readonly redactor: Redactor;
  private readonly reporter: ProgressReporter;
  /** 이번 실행에서 올린 결과물 수 */
  private sent = 0;
  /** 마지막 검사 (칸의 일). 제출하는 결과에 싣는다 */
  private checks: readonly StageCheck[] = [];
  /** 서버에 있는 로그인의 판. 바뀐 자격을 되돌려 쓸 때마다 새 판이 된다 (AI를 두 번 띄우면 두 번 쓴다) */
  private loginVersion: number | null;
  /** 마지막으로 되돌려 쓴 자격 */
  private written: string | null = null;
  /** 일의 도구 어댑터. 토큰이 없거나 모르는 도구면 null (perform이 시작 전에 끝낸다) */
  private readonly tool: AiTool | null;

  constructor(
    private readonly job: Job,
    private readonly login: AiLogin,
    private readonly server: CairnServer,
    private readonly config: RunnerConfig,
    private readonly log: RunLog,
    redactor: Redactor,
    private readonly stop: AbortSignal,
    /** 코드 러너 칸에서 하는 일의 앞뒤 (코드 · 만들기). 그 밖의 일은 null */
    private readonly stage: SandboxStage | null = null,
  ) {
    this.tool = login.token === null ? null : AiTools.for(job.tool, login.token, config);
    // 자격 안의 토큰 (Codex auth.json의 access · refresh) · 외부 도구의 머리글 값까지 로그와 기록에서 지운다
    this.redactor = [...(this.tool?.secrets ?? []), ...job.runtime.secrets].reduce(
      (r, secret) => r.with(secret),
      redactor.with(job.runToken).with(login.token),
    );
    this.reporter = new ProgressReporter(server, job.taskId, this.redactor, job.leaseUntil);
    this.loginVersion = login.version;
  }

  async perform(): Promise<void> {
    let workspace: JobWorkspace | null = null;
    try {
      const unfit = this.refusal();
      if (unfit) return await this.conclude(unfit);
      // 토큰이 없는 것은 일의 실패가 아니다. 돌려주고, 주인이 토큰을 넣으면 다시 맡는다
      if (this.tool === null) return await this.conclude(RunEnding.release(this.login.problem));
      const { stage } = this;
      if (stage) {
        const ending = await this.during((signal) =>
          stage.prepare(signal, this.note, this.redactor),
        );
        if (ending) return await this.conclude(ending);
      }
      const prompts = PromptPack.choose(this.job.promptPackage, this.config.skillsDir, this.log);
      // 단계가 더한 것(브라우저 작업이 도는 곳)이 AI CLI의 설정(mcp.json)에 실린다
      const job = stage?.aiJob(prompts) ?? this.job;
      workspace = await this.tool.open(job, stage?.workspaceRoom ?? null);
      await workspace.handOver(this.job.sharedFolders(this.config.folders));
      const { skill, skillPackage: shipped } = this.job;
      if (shipped) this.log.info(`스킬 ${shipped.name}: ${shipped.label}`);
      else if (skill && JobWorkspace.skillText(skill, this.config.skillsDir) === null)
        this.log.info(`스킬 ${skill}이 없어 지시만으로 해요`);
      await this.supervise(workspace, this.tool, prompts);
    } catch (error) {
      if (!(error instanceof CliUnavailable))
        await this.conclude(RunEnding.release(`러너 오류: ${(error as Error).message}`));
      throw error;
    } finally {
      await workspace?.remove();
      await this.stage?.close();
    }
  }

  /** 실행 기록 한 줄 (코드 작업의 단계) */
  private readonly note = (event: RunEvent): void => this.reporter.add([event]);

  /**
   * 오래 걸리는 단계(clone · setup · checks · push) 동안에도 보고 고리를 돌린다: 임대를 늘리고 취소 · 멈춤 · 러너 멈춤을 듣는다.
   * 끝낼 이유가 생기면 단계를 그만두게(signal) 하고 그 끝을 준다. 단계가 스스로 끝나면 단계의 값
   */
  private async during<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T | RunEnding> {
    const cut = new AbortController();
    const wake = new AbortController();
    const running = work(AbortSignal.any([cut.signal, this.stop])).finally(() => wake.abort());
    const alarm = AbortSignal.any([wake.signal, this.stop]);
    for (;;) {
      await pause(JobRun.REPORT_MS, alarm);
      if (wake.signal.aborted) return running;
      const ending = this.stop.aborted
        ? RunEnding.release(JobRun.STOPPING)
        : await this.reportOnce();
      if (ending) {
        cut.abort();
        await running.catch(() => {});
        return ending;
      }
    }
  }

  /** 시작도 하지 않고 끝낼 일 */
  private refusal(): RunEnding | null {
    if (this.stop.aborted) return RunEnding.release(JobRun.STOPPING);
    if (AiTools.SUPPORTED.includes(this.job.tool)) return null;
    const error = `${this.job.tool}는 아직 러너가 지원하지 않아요`;
    return RunEnding.submit(error, RunResult.failed(error, this.redactor));
  }

  /**
   * place: 이 일의 작업 자리. AI가 잘 끝났는데 칸의 검사에 떨어지면 같은 자리에서 한 번 더 맡긴다 (검증 고리 V).
   * 두 번째 실행도 첫 실행과 같이 지켜본다: 취소 · 멈춤 · 임대 · 격리가 깨지면 끄고 끝낸다
   */
  private async supervise(place: JobWorkspace, tool: AiTool, prompts: PromptPack): Promise<void> {
    const job = this.stage?.aiJob(prompts) ?? place.withShared(this.job, prompts);
    let run = await this.runAi(job, place, tool, prompts);
    for (let retries = 0; run.ending.succeeded && this.stage !== null; retries++) {
      const stopped = await this.check(this.stage, retries > 0);
      if (stopped) return await this.conclude(stopped);
      if (retries >= JobRun.CHECK_RETRIES || this.checks.every((c) => c.ok)) break;
      this.note(new RunEvent(RunEvent.READ, '검사에 떨어져 AI에게 한 번 더 맡겨요', 0));
      const fix = StageCheck.retryJob(job, prompts, run.stream.finalText, this.checks);
      run = await this.runAi(fix, place, tool, prompts);
    }
    await this.conclude(run.ending.succeeded ? await this.afterExit(run, place) : run.ending);
  }

  /**
   * AI CLI를 한 번 띄워 끝날 때까지 지켜본다. 끝낼 이유가 생기면 끄고 그 끝, 스스로 끝났으면 남은 기록을 보내고
   * 아직 내 일인지 본 뒤 AI의 끝 (잘 끝났으면 succeeded)
   */
  private async runAi(
    job: Job,
    place: JobWorkspace,
    tool: AiTool,
    prompts: PromptPack,
  ): Promise<{ ending: RunEnding; stream: AiStream }> {
    const stream = tool.stream();
    const wake = new AbortController();
    const child = tool.start(job, place, prompts, (line) => {
      this.reporter.add(stream.read(line));
      this.reporter.notePlan(stream.takePlanUsage());
      this.reporter.noteModel(stream.model);
      if (stream.breach !== null) wake.abort();
    });
    void child.exited.then(() => wake.abort());
    const decided = await this.watch(stream, wake.signal);
    if (decided) await child.kill();
    const exit = await child.exited;
    this.reporter.add(stream.finish());
    if (exit.spawnError !== null) {
      await this.conclude(RunEnding.release(`AI CLI를 실행하지 못했어요: ${exit.spawnError}`));
      throw new CliUnavailable(`AI CLI를 실행하지 못했어요 (${tool.bin})`);
    }
    await this.writeBack(tool, place);
    const ending = decided
      ? ((await this.flush()) ?? decided)
      : ((await this.flushForSubmit()) ?? this.fromExit(exit, stream, child));
    return { ending, stream };
  }

  /** 칸의 검사를 돌려 기억한다 (retried: AI에게 한 번 더 맡긴 뒤). 그사이 끝낼 이유가 생기면 그 끝 */
  private async check(stage: SandboxStage, retried: boolean): Promise<RunEnding | null> {
    const found = await this.during((signal) => stage.check(signal, this.note));
    if (found instanceof RunEnding) return found;
    // 러너가 멈춰 검사가 돌린 데까지만 돌아왔다
    if (this.stop.aborted) return RunEnding.release(JobRun.STOPPING);
    this.checks = retried ? found.map((c) => c.asRetried()) : found;
    return null;
  }

  /**
   * AI가 잘 끝난 뒤. 칸의 일이 잘 끝났으면 단계의 뒤(올리기)까지 한 결과가 끝이다.
   * 만들기 작업이 결과물을 하나도 올리지 못했으면 실패다.
   * 잘 끝났으면 결과물(outputs 폴더의 파일)을 올리고 제출한다: 제출하면 작업이 끝나 표를 받을 수 없다
   */
  private async afterExit(
    run: { ending: RunEnding; stream: AiStream },
    workspace: JobWorkspace,
  ): Promise<RunEnding> {
    const { stage, checks, note, redactor } = this;
    let finished = run.ending;
    if (stage !== null) {
      const { finalText } = run.stream;
      finished = await this.during((signal) =>
        stage.finish(finalText, checks, signal, note, redactor, workspace.workDir),
      );
      // 단계 뒤에 남은 기록(올림)을 보내고, 그사이 취소됐는지 한 번 더 본다
      const after = await this.flushForSubmit();
      if (after || !finished.succeeded) return after ?? finished;
    }
    const shipped = await this.during((signal) => this.shipOutputs(workspace, signal));
    const afterShip = (await this.flushForSubmit()) ?? shipped ?? this.nothingMade();
    if (afterShip || stage === null || !stage.awaitsApproval) return afterShip ?? finished;
    // code-github: PR의 머지 결재를 결과물 뒤에 올린다 (결재 대기가 되면 임대가 끝나 결과물을 올릴 수 없다).
    // 올리면 작업은 결재 대기가 되고, 아래 보고에서 그것을 보고 제출하지 않고 끝낸다
    const asked = await this.during((signal) => stage.requestApproval(signal, this.redactor));
    return (await this.flushForSubmit()) ?? asked ?? finished;
  }

  /**
   * outputs 폴더의 파일을 결과물로 올린다. 뺀 파일과 서버가 받지 않은 파일은 실행 기록에 남기고 이어 간다.
   * 끝내 서버에 닿지 못하면 실패로 끝낸다 (만든 파일을 잃은 채 done이 되지 않게). 올릴 것이 없으면 null
   */
  private async shipOutputs(
    workspace: JobWorkspace,
    signal: AbortSignal,
  ): Promise<RunEnding | null> {
    const batch = await OutputBatch.collect(
      workspace.outputsDir,
      workspace.outputsStage,
      workspace.user,
      signal,
    );
    for (const line of batch.skipped)
      this.note(new RunEvent(RunEvent.ERROR, `결과물에서 뺐어요: ${line}`, 0));
    if (batch.files.length === 0) return null;
    const uploader = new OutputUploader(this.server, this.config.serverUrl);
    const sent = await uploader.uploadAll(this.job.taskId, batch.files, signal, this.note);
    if (typeof sent === 'string')
      return RunEnding.submit(sent, RunResult.failed(sent, this.redactor));
    if (sent > 0) this.note(new RunEvent(RunEvent.WRITE, `결과물 ${sent}개를 올렸어요`, 0));
    this.sent = sent;
    return null;
  }

  /** 파일을 만드는 일(만들기)이 결과물을 하나도 올리지 못했으면 실패. 그 밖에는 null */
  private nothingMade(): RunEnding | null {
    if (this.stage === null || !this.stage.needsOutputs || this.sent > 0) return null;
    const error = '만든 파일이 없어요. outputs 폴더에 둔 파일만 결과물이 돼요';
    return RunEnding.submit(error, RunResult.failed(error, this.redactor));
  }

  /**
   * 끝낼 이유가 생기거나 AI CLI가 끝날 때까지 기록을 보낸다. 조용해도 빈 보고를 보내 임대를 늘리고 서버의 답을 듣는다.
   * wake는 AI CLI가 끝났거나 격리가 깨졌을 때 울린다. 스스로 끝났으면 null
   */
  private async watch(stream: AiStream, wake: AbortSignal): Promise<RunEnding | null> {
    const alarm = AbortSignal.any([wake, this.stop]);
    for (;;) {
      await pause(JobRun.REPORT_MS, alarm);
      if (stream.breach !== null) return this.breached(stream);
      if (this.stop.aborted) return RunEnding.release(JobRun.STOPPING);
      if (wake.aborted) return null;
      const ending = await this.reportOnce();
      if (ending) return ending;
    }
  }

  /** 다른 MCP 서버나 열린 셸이 보이면 격리가 깨진 것이다. 쓰기 전에 끈다 */
  private breached(stream: AiStream): RunEnding {
    const error = `격리가 깨져 멈췄어요. ${stream.breach}`;
    return RunEnding.submit(error, RunResult.failed(error, this.redactor));
  }

  private async reportOnce(): Promise<RunEnding | null> {
    try {
      return JobRun.decide(await this.reporter.send());
    } catch (error) {
      const ending = JobRun.endingOfFailure(error);
      if (ending) return ending;
      this.log.info(`기록을 보내지 못해 다시 보내요: ${(error as Error).message}`);
      return this.reporter.leaseOver ? RunEnding.quiet('임대가 끝났어요') : null;
    }
  }

  /** 끄고 난 뒤: 남은 기록을 한 번씩만 보낸다. 끝내는 길은 이미 정해졌고, 임대가 끝나면 서버가 정리한다 */
  private async flush(): Promise<RunEnding | null> {
    try {
      do {
        const ending = JobRun.decide(await this.reporter.send());
        if (ending && ending.releaseReason === null) return ending;
      } while (!this.reporter.idle);
      return null;
    } catch (error) {
      const ending = JobRun.endingOfFailure(error);
      if (!ending) this.log.info(`남은 기록을 보내지 못했어요: ${(error as Error).message}`);
      return ending;
    }
  }

  /** 제출 전: 기록을 끝까지 보내고 작업이 아직 내 것인지 본다. 끝나지 않은 상태로만 null */
  private async flushForSubmit(): Promise<RunEnding | null> {
    try {
      do {
        const state = await this.persist(() => this.reporter.send());
        if (state.cancelled || state.status !== ProgressState.RUNNING) return JobRun.decide(state);
      } while (!this.reporter.idle);
      return null;
    } catch (error) {
      return (
        JobRun.endingOfFailure(error) ??
        RunEnding.quiet(`서버에 닿지 못해 제출하지 못했어요: ${(error as Error).message}`)
      );
    }
  }

  /**
   * 실행하는 동안 CLI가 갱신한 자격(Codex auth.json)을 서버에 되돌려 쓴다. 끝내는 길(성공 · 실패 · 취소)과 상관없이:
   * 버리면 다음 실행이 이미 쓴 갱신 토큰을 내밀어 로그인이 깨진다. 이 컴퓨터의 로그인(판 없음)은 서버에 쓰지 않는다.
   * 판이 다르면(주인이 그사이 다시 로그인) 서버가 거절하고 새 로그인이 이긴다
   */
  private async writeBack(tool: AiTool, workspace: JobWorkspace): Promise<void> {
    const version = this.loginVersion;
    if (version === null) return;
    const credential = await tool.changedCredential(workspace);
    if (credential === null || credential === this.written) return;
    try {
      this.loginVersion = await this.persist(() =>
        this.server.aiLoginRefresh(this.job.taskId, tool.id, version, credential),
      );
      this.written = credential;
      this.log.info(`${this.job.taskId}: 갱신된 ${tool.id} 로그인을 서버에 저장했어요`);
    } catch (error) {
      this.log.info(
        `${this.job.taskId}: 갱신된 로그인을 저장하지 못했어요: ${(error as Error).message}`,
      );
    }
  }

  private fromExit(exit: ChildExit, stream: AiStream, child: AiProcess): RunEnding {
    if (exit.code === 0 && stream.failure === null)
      return RunEnding.submit('끝났어요', RunResult.from(stream, this.redactor));
    const how = exit.signal ? `신호 ${exit.signal}` : `코드 ${exit.code}`;
    const why = stream.failure || child.stderrTail;
    const error = why ? `AI CLI가 ${how}로 끝났어요: ${why}` : `AI CLI가 ${how}로 끝났어요`;
    return RunEnding.submit(error, RunResult.failed(error, this.redactor, stream.connectorCalls));
  }

  /** 끝을 알린다. 칸의 검사를 돌렸으면 제출하는 결과에 마지막 검사를 싣는다 */
  private async conclude(ending: RunEnding): Promise<void> {
    this.log.info(this.redactor.clean(`${this.job.taskId}: ${ending.note}`));
    const { releaseReason } = ending;
    const result = ending.result?.with(StageCheck.resultOf(this.checks)) ?? null;
    try {
      if (releaseReason !== null)
        await this.persist(() => this.server.release(this.job.taskId, releaseReason));
      if (result !== null) await this.persist(() => this.server.submit(this.job.taskId, result));
    } catch (error) {
      this.log.info(`${this.job.taskId}: 끝을 알리지 못했어요: ${(error as Error).message}`);
    }
  }

  /** 닿지 못하면 임대가 살아 있는 동안 같은 요청을 다시 보낸다. 임대가 끝나면 서버가 어차피 거절한다 */
  private async persist<T>(send: () => Promise<T>): Promise<T> {
    const backoff = new Backoff(JobRun.RETRY_FIRST_MS, JobRun.RETRY_MAX_MS);
    let stopBy: number | null = null;
    for (;;) {
      try {
        return await send();
      } catch (error) {
        if (this.stop.aborted) stopBy ??= Date.now() + JobRun.STOP_RETRY_MS;
        const outOfTime = stopBy !== null && Date.now() >= stopBy;
        if (!(error instanceof ServerUnreachable) || this.reporter.leaseOver || outOfTime)
          throw error;
        this.log.info(`다시 보내요: ${error.message}`);
        await backoff.wait();
      }
    }
  }

  /** 서버의 답으로 끝낼지 정한다. 계속해도 되면 null */
  private static decide(state: ProgressState): RunEnding | null {
    if (state.cancelled) return RunEnding.quiet('주인이 취소했어요');
    if (state.status === ProgressState.WAITING)
      return RunEnding.quiet('결재나 하위 작업을 기다려요');
    if (state.status !== ProgressState.RUNNING)
      return RunEnding.quiet(`이미 ${state.status} 상태예요`);
    return state.paused ? RunEnding.release(JobRun.PAUSED) : null;
  }

  /** 다시 보내도 소용없는 실패면 그만둔다. 일은 이미 이 러너의 것이 아니다 */
  private static endingOfFailure(error: unknown): RunEnding | null {
    if (error instanceof ToolRefused || error instanceof AccessDenied)
      return RunEnding.quiet(`서버가 거절했어요: ${error.message}`);
    if (error instanceof ServerUnreachable) return null;
    throw error;
  }
}
