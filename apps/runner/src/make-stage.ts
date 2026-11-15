import type { AgentUser } from './agent-user';
import type { CairnServer } from './cairn-server';
import type { Job } from './job';
import { RunEnding } from './job-run';
import {
  MaterialBroken,
  MaterialDownloader,
  type MaterialFile,
  MaterialGone,
} from './material-downloader';
import { ServerUnreachable, ToolRefused } from './mcp-client';
import type { PageBase } from './page-base';
import { RunEvent, RunResult } from './progress';
import type { PromptPack } from './prompt-pack';
import type { Redactor, RunLog } from './redactor';
import type { RunnerConfig } from './runner-config';
import { SandboxRoom } from './sandbox-room';
import type { SandboxStage } from './sandbox-stage';

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
//   앞: 자리 → 고칠 페이지의 지금 판(page_base, 글 파일을 inputs/page/에) → 재료 결과물을 표로 받아 inputs/에(러너)
//       → 빈 작업 폴더 · 재료를 agent에게
//   뒤: agent 프로세스를 모두 끄고(띄워 둔 변환기 · 서버) 요약을 결과로. 올린 결과물이 없으면 JobRun이 실패로 끝낸다
// 재료 위키는 받지 않는다: 작업 토큰에 봉인한 허락으로 AI가 get_wiki로 읽는다 (지시문에 id만).
// 결재는 없다: Cairn 안에 보관하는 것은 발행이 아니다.
export class MakeStage implements SandboxStage {
  private static readonly SUMMARY_MAX = 4_000;
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
  private unreached = false;

  constructor(
    private readonly job: Job,
    private readonly config: RunnerConfig,
    private readonly agent: AgentUser,
    private readonly log: RunLog,
    /** 기기 토큰으로 연 서버 (begin_download) */
    private readonly server: CairnServer,
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
    if (!materials && !this.job.page) return null;
    const shown = room === null ? [] : files;
    const base = this.base;
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
    let page: PageBase | null = null;
    if (this.job.page) {
      try {
        page = await this.server.pageBase(this.job.taskId, signal);
      } catch (error) {
        if (signal.aborted) return null;
        if (error instanceof ToolRefused)
          return failed(`고칠 페이지를 받지 못했어요: ${error.message}`);
        if (error instanceof ServerUnreachable) {
          this.unreached = true;
          return RunEnding.release(`고칠 페이지를 받지 못해 돌려줘요: ${error.message}`);
        }
        throw error;
      }
    }
    const inputs = outputs.length > 0 || page !== null ? await room.openInputs() : null;
    if (page !== null && inputs !== null) {
      this.base = { page, dir: await page.writeTo(inputs) };
      note(new RunEvent(RunEvent.READ, `고칠 페이지의 버전 ${page.seq}를 받았어요`, 0));
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

  async finish(
    summary: string,
    _signal: AbortSignal,
    _note: (event: RunEvent) => void,
    redactor: Redactor,
  ): Promise<RunEnding> {
    // 결과물을 모으기 전에: AI가 띄워 둔 변환기 · 서버가 파일을 쥐고 있지 않게
    await this.agent.killAll();
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
