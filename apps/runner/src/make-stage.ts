import { join } from 'node:path';
import type { AgentUser, FolderEntry } from './agent-user';
import type { AppCodeBase } from './app-code-base';
import { AppCodeCheck, AppCodeEntry } from './app-code-check';
import { AppManifestCheck } from './app-manifest-check';
import { DesignCheck } from './design-check';
import { DesignDocCheck } from './design-doc-check';
import type { Job } from './job';
import {
  MaterialBroken,
  MaterialDownloader,
  type MaterialFile,
  MaterialGone,
} from './material-downloader';
import { ServerUnreachable, ToolRefused } from './mcp-client';
import type { MoidaServer } from './moida-server';
import { OutputBatch } from './output-batch';
import type { PageBase } from './page-base';
import { RunEvent, RunResult } from './progress';
import type { PromptPack } from './prompt-pack';
import type { Redactor, RunLog } from './redactor';
import { RunEnding } from './run-ending';
import type { RunnerConfig } from './runner-config';
import { SandboxRoom } from './sandbox-room';
import type { SandboxStage } from './sandbox-stage';
import { StageCheck } from './stage-check';
import { ZipIndex } from './zip-index';

/** 만들기 작업의 재료 id (payload.make). 서버가 이미 걸렀지만 지시문 · 도구 입력에 쓰기 전에 모양을 다시 본다 */
export class MakeMaterials {
  private static readonly UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  private static readonly MAX = 10;

  private constructor(
    readonly outputs: readonly string[],
    readonly wikis: readonly string[],
  ) {}

  static from(payload: unknown): MakeMaterials {
    const make = (typeof payload === 'object' && payload !== null ? payload : {}) as {
      outputs?: unknown;
      wikis?: unknown;
    };
    return new MakeMaterials(MakeMaterials.ids(make.outputs), MakeMaterials.ids(make.wikis));
  }

  private static ids(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const ids = raw.filter((v): v is string => typeof v === 'string' && MakeMaterials.UUID.test(v));
    return [...new Set(ids)].slice(0, MakeMaterials.MAX);
  }
}

// 만들기 작업의 앞뒤 (결과물 2차). 칸 안에서 AI가 셸로 PPT · 문서 · 영상을 만들어 outputs/에 두면 JobRun이 결과물로 올린다.
//   앞: 자리 → 고칠 페이지의 지금 판(page_base, 글 파일을 inputs/page/에) · 고칠 앱의 지금 코드(app_code_base, inputs/app/에)
//       → 재료 결과물을 표로 받아 inputs/에(러너) → 빈 작업 폴더 · 재료를 agent에게
//   검사: outputs 폴더에 올릴 파일이 있는가, 페이지 일이면 문(index.html)이 있는가, 앱 코드 일이면 묶음 · 템플릿(AppCodeCheck).
//       떨어지면 JobRun이 AI에게 한 번 더 맡긴다. 앱 코드의 묶음 · 문법이 그래도 틀리면 실패로 끝낸다 (틀린 템플릿이 버전이 되지 않게)
//   뒤: agent 프로세스를 모두 끄고(띄워 둔 변환기 · 서버) 요약을 결과로. 올린 결과물이 없으면 JobRun이 실패로 끝낸다
//       (검사를 지나도 서버가 받지 않으면 없을 수 있다)
// 재료 위키는 받지 않는다: 작업 토큰에 봉인한 허락으로 AI가 get_wiki로 읽는다 (지시문에 id만).
// 결재는 없다: Moida 안에 보관하는 것은 발행이 아니다.
export class MakeStage implements SandboxStage {
  private static readonly SUMMARY_MAX = 4_000;
  /** 페이지의 문 (서버의 PageOrder.ENTRY) */
  private static readonly ENTRY = 'index.html';
  /** 앱 코드의 moida.json 한도 (서버의 AppCodeBundle.MANIFEST_BYTES_MAX) */
  private static readonly MANIFEST_MAX = 16 * 1024;
  readonly awaitsApproval = false;
  readonly needsOutputs = true;

  private readonly materials: MakeMaterials;
  private room: SandboxRoom | null = null;
  /** 받은 재료 파일 */
  private files: readonly MaterialFile[] = [];
  /** 그사이 휴지통에 가 받지 못한 재료 */
  private gone: readonly string[] = [];
  /** 고칠 페이지의 가장 새 판과 그 글 파일을 둔 폴더 (자라는 페이지). 처음 만드는 페이지면 null */
  private base: { page: PageBase; dir: string } | null = null;
  /** 고칠 앱의 지금 코드와 그 글 파일을 둔 폴더 (앱 코드 일만, 스토어 1-6) */
  private app: { code: AppCodeBase; dir: string } | null = null;
  private unreached = false;

  constructor(
    private readonly job: Job,
    private readonly config: RunnerConfig,
    private readonly agent: AgentUser,
    private readonly log: RunLog,
    /** 기기 토큰으로 연 서버 (begin_download) */
    private readonly server: MoidaServer,
  ) {
    this.materials = MakeMaterials.from(job.makePayload);
  }

  get unreachable(): boolean {
    return this.unreached;
  }

  get workspaceRoom(): SandboxRoom | null {
    return this.room;
  }

  aiJob(prompts: PromptPack): Job {
    const brief = this.brief(prompts);
    return brief === null ? this.job : this.job.withBrief(brief);
  }

  /** AI에게 재료와 페이지 규칙을 알리는 단락 (틀 make). 알릴 것이 없으면 null. 서버는 페이지 일에 index.html이 없으면 실패로 끝낸다 */
  private brief(prompts: PromptPack): string | null {
    const { files, gone, room } = this;
    const { wikis } = this.materials;
    const materials = files.length > 0 || wikis.length > 0 || gone.length > 0;
    if (!materials && !this.job.page && !this.app) return null;
    const shown = room === null ? [] : files;
    const base = this.base;
    const app = this.app;
    return prompts.fill('make', {
      materials,
      inputs: room?.inputsDir ?? null,
      files: shown.map((f) => `- ${f.name} (${MakeStage.sizeOf(f.size)})`).join('\n'),
      wikis: wikis.map((id) => `- wiki_id: ${id}`).join('\n'),
      gone: gone.length,
      page: this.job.page,
      base: base?.dir ?? null,
      baseTitle: base?.page.title ?? null,
      baseSeq: base?.page.seq ?? null,
      baseFiles: base?.page.listing ?? null,
      direction: base?.page.direction ?? null,
      app: app !== null,
      appName: app?.code.name ?? null,
      appKind: app?.code.kind ?? null,
      appVersion: app?.code.version ?? null,
      appDir: app?.dir ?? null,
      appFiles: app?.code.listing ?? null,
      appHosts: app?.code.hosts.join(' · ') || null,
    });
  }

  async prepare(
    signal: AbortSignal,
    note: (event: RunEvent) => void,
    redactor: Redactor,
  ): Promise<RunEnding | null> {
    const failed = (error: string) => RunEnding.submit(error, RunResult.failed(error, redactor));
    const room = await SandboxRoom.open(this.config.workDir, this.job.taskId, this.agent);
    this.room = room;
    // 재료(payload.make)와 대화 · 위임으로 넣은 참조 결과물(payload.refs)을 함께 받는다 (2026-11-15 B)
    const outputs = [...new Set([...this.materials.outputs, ...this.job.refs.outputs])];
    const id = this.job.taskId;
    const page = this.job.page
      ? await this.fetchBase('고칠 페이지', () => this.server.pageBase(id, signal), signal, failed)
      : null;
    if (page instanceof RunEnding || page === undefined) return page ?? null;
    const app = this.job.appCode
      ? await this.fetchBase(
          '고칠 앱 코드',
          () => this.server.appCodeBase(id, signal),
          signal,
          failed,
        )
      : null;
    if (app instanceof RunEnding || app === undefined) return app ?? null;
    if (this.job.appCode && app === null) return failed('고칠 앱을 찾지 못했어요');
    const opened = outputs.length > 0 || page !== null || app !== null;
    const inputs = opened ? await room.openInputs() : null;
    if (page !== null && inputs !== null) {
      this.base = { page, dir: await page.writeTo(inputs) };
      note(new RunEvent(RunEvent.READ, `고칠 페이지의 버전 ${page.seq}를 받았어요`, 0));
    }
    if (app !== null && inputs !== null) {
      this.app = { code: app, dir: await app.writeTo(inputs) };
      note(new RunEvent(RunEvent.READ, `고칠 앱 코드(${app.version})를 받았어요`, 0));
    }
    if (outputs.length > 0 && inputs !== null) {
      const dir = inputs;
      const downloader = new MaterialDownloader(this.server, this.config.serverUrl);
      const files: MaterialFile[] = [];
      const gone: string[] = [];
      note(new RunEvent(RunEvent.READ, `재료 파일 ${outputs.length}개를 받아요`, 0));
      for (const id of outputs) {
        try {
          files.push(await downloader.download(this.job.taskId, id, dir, signal));
        } catch (error) {
          if (signal.aborted) return null;
          if (error instanceof MaterialGone) {
            gone.push(id);
            note(new RunEvent(RunEvent.ERROR, `재료에서 뺐어요 (${id}): ${error.message}`, 0));
            continue;
          }
          if (error instanceof MaterialBroken)
            return failed(`재료를 받지 못했어요: ${error.message}`);
          if (error instanceof ServerUnreachable) {
            this.unreached = true;
            return RunEnding.release(`재료를 받지 못해 돌려줘요: ${error.message}`);
          }
          throw error;
        }
      }
      this.files = files;
      this.gone = gone;
      note(new RunEvent(RunEvent.RESULT, `재료 파일 ${files.length}개를 받았어요`, 0));
    }
    await room.handOver(false);
    return null;
  }

  /**
   * 고칠 페이지 · 앱 코드를 서버에서 받는다. 서버가 거절하면 실패, 닿지 못하면 돌려주기(RunEnding),
   * 멈췄으면 undefined (끝낼 것 없이 나간다)
   */
  private async fetchBase<T>(
    what: string,
    fetch: () => Promise<T>,
    signal: AbortSignal,
    failed: (error: string) => RunEnding,
  ): Promise<T | RunEnding | undefined> {
    try {
      return await fetch();
    } catch (error) {
      if (signal.aborted) return undefined;
      if (error instanceof ToolRefused) return failed(`${what}를 받지 못했어요: ${error.message}`);
      if (error instanceof ServerUnreachable) {
        this.unreached = true;
        return RunEnding.release(`${what}를 받지 못해 돌려줘요: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 만든 파일이 outputs 폴더 바로 아래에 있는가 (OutputBatch가 올리는 이름의 보통 파일).
   * 새 페이지를 만드는 일이면 문(index.html)도 (고치는 일은 바뀐 파일만 내도 된다: 서버의 PageOrder.refusal).
   * 앱 코드 일이면 받은 코드 위에 얹은 묶음 · 템플릿 (AppCodeCheck). 그 밖에는 목록만 읽고 파일은 열지 않는다
   */
  async check(): Promise<StageCheck[]> {
    if (this.room === null) return [];
    const dir = this.room.outputsDir;
    // 목록 · 크기는 agent 권한으로 읽는다 (칸의 러너는 agent의 700 폴더를 직접 읽지 못한다)
    const listed = await this.agent.list(dir);
    const files = (listed ?? []).filter((e) => e.file && OutputBatch.nameProblem(e.name) === null);
    const names = files.map((e) => e.name);
    const made = names.length > 0;
    const none =
      listed === null
        ? `${dir}를 읽지 못했어요 (러너의 문제예요. 파일을 다시 만들 필요는 없어요)`
        : `${dir} 바로 아래에 둔 파일이 없어요 (폴더 · 링크 · 숨김 파일은 올라가지 않아요)`;
    const checks = [
      StageCheck.seen('결과물 파일', made, made ? `${names.length}개` : '없음', none),
    ];
    if (this.app !== null)
      return [...checks, ...(await this.codeChecks(this.app.code, dir, files))];
    if (!this.job.page || this.base !== null) return checks;
    const entry = names.includes(MakeStage.ENTRY);
    const why = `새 페이지는 ${dir}/${MakeStage.ENTRY}가 문이에요. 없으면 페이지가 되지 않아요`;
    checks.push(StageCheck.seen(MakeStage.ENTRY, entry, entry ? '있음' : '없음', why));
    return checks;
  }

  /**
   * 앱 코드 일의 검사. app.zip을 냈으면 그 안이 묶음 전체다 (폴더가 든 정적 앱, 스토어 9.13): zip의 파일 목록과 moida.json을 본다.
   * 그 밖에는 받은 코드 위에 낸 파일을 얹은 모양을 본다
   */
  private async codeChecks(
    code: AppCodeBase,
    dir: string,
    files: readonly FolderEntry[],
  ): Promise<StageCheck[]> {
    if (!files.some((f) => f.name === AppCodeCheck.PACKED))
      return AppCodeCheck.checks(code, await this.madeCode(dir, files));
    const bytes = await this.agent.readBytes(
      join(dir, AppCodeCheck.PACKED),
      AppCodeCheck.BYTES_MAX,
    );
    const zip = bytes === null ? null : ZipIndex.read(bytes);
    if (zip === null) return AppCodeCheck.packed(code, null);
    return AppCodeCheck.packed(
      code,
      zip.entries.map(
        (e) =>
          new AppCodeEntry(
            e.name,
            e.size,
            AppManifestCheck.isManifest(e.name)
              ? zip.text(e.name, MakeStage.MANIFEST_MAX)
              : e.name === DesignDocCheck.FILE
                ? zip.text(e.name, DesignDocCheck.BYTES_MAX)
                : null,
          ),
      ),
    );
  }

  /**
   * 앱 코드 일에서 AI가 낸 파일: 크기와, 템플릿 · CSS · moida.json의 글. 글은 agent 권한으로 읽는다 (AI가 둔 링크를 러너가 따라가지 않게).
   * 한도를 넘는 글은 null (검사가 떨어진다)
   */
  private async madeCode(dir: string, files: readonly FolderEntry[]): Promise<AppCodeEntry[]> {
    const made: AppCodeEntry[] = [];
    for (const { name, size } of files) {
      const path = join(dir, name);
      // CSS도 글로 읽는다: 디자인 기준 검사가 색 토큰 · 포커스 · 움직임을 본다
      const max =
        AppCodeCheck.isTemplate(name) || DesignCheck.isStyle(name)
          ? AppCodeCheck.TEMPLATE_BYTES_MAX
          : AppManifestCheck.isManifest(name)
            ? MakeStage.MANIFEST_MAX
            : name === DesignDocCheck.FILE
              ? DesignDocCheck.BYTES_MAX
              : -1;
      const text = max < 0 ? null : await this.agent.readFile(path, max);
      made.push(new AppCodeEntry(name, size, text));
    }
    return made;
  }

  async finish(
    summary: string,
    checks: readonly StageCheck[],
    _signal: AbortSignal,
    _note: (event: RunEvent) => void,
    redactor: Redactor,
  ): Promise<RunEnding> {
    // 결과물을 모으기 전에: AI가 띄워 둔 변환기 · 서버가 파일을 쥐고 있지 않게
    await this.agent.killAll();
    // 앱 코드의 묶음 · 문법이 한 번 더 고친 뒤에도 틀리면 올리지 않는다 (틀린 템플릿이 버전이 되지 않게)
    const broken = this.app === null ? null : AppCodeCheck.fatal(checks);
    if (broken) {
      const error = `앱 코드의 ${broken.name} 검사에 떨어져 새 버전을 만들지 않았어요 (${broken.how})`;
      return RunEnding.submit(error, RunResult.failed(error, redactor));
    }
    const brief = summary.trim().slice(0, MakeStage.SUMMARY_MAX) || '(요약 없음)';
    return RunEnding.submit('만들었어요', RunResult.done(brief, redactor));
  }

  async requestApproval(): Promise<RunEnding | null> {
    return null;
  }

  async close(): Promise<void> {
    try {
      await this.room?.close();
    } catch (error) {
      this.log.info(`${this.job.taskId}: 작업 자리를 지우지 못했어요: ${(error as Error).message}`);
    }
  }

  private static sizeOf(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }
}
