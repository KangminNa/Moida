import { mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { CairnServer } from './cairn-server';
import type { Job } from './job';
import { RefPhotos } from './job-refs';
import type { JobWorkspace } from './job-workspace';
import { MaterialDownloader } from './material-downloader';
import { RunEvent } from './progress';

/** AI CLI가 사진을 보는 법: read 받은 파일을 읽는다 (Claude Read) · attach 지시에 붙인다 (codex exec --image) */
export type PhotoSight = 'read' | 'attach';

// 대화에 넣은 사진 받기 (대화에 사진 넣기 ②-b, 기획서 결정 2026-11-19). 서버가 참조에 image로 표시한 결과물을
// begin_download로 작업 폴더의 photos/에 받아 AI CLI가 직접 보게 한다. 내려받기 허락은 참조 결과물 그대로다 (서버 TaskQuery.heldMaterial).
// 칸의 일은 받지 않는다: 만들기는 MakeStage가 재료와 함께 inputs/로 받고, 코드 작업은 이름만 보인다.
// photos/는 outputs/와 따로 두어 결과물로 다시 올라가지 않는다. 작업 자리는 일마다 새로 만들거나 비우므로 지난 사진은 남지 않는다.
// 사진은 덤이다: 10MB가 넘거나 · 형식이 다르거나 · 시간 안에 받지 못하면 실행 기록에 남기고, 지시문에는 받지 못한 사진으로 적고 이어 간다.
// 이름은 서버의 이름 대신 photo-<n>.<형식>으로 정한다: 앞부분으로 형식을 다시 보고 그 확장자를 붙인다
// (Claude의 Read가 확장자로 그림을 알아보고, --image는 값을 쉼표로 나눈다).
export class JobPhotos {
  /** 사진 하나의 한도 (웹이 사진을 넣을 때와 같다) */
  static readonly MAX_BYTES = 10 * 1024 * 1024;
  /** 작업 폴더 안의 사진 폴더 */
  static readonly FOLDER = 'photos';
  /** 사진을 모두 받는 데 쓰는 시간의 끝: 덤이라 오래 기다리지 않는다 (그동안에도 JobRun이 임대를 늘린다) */
  private static readonly RECEIVE_MS = 2 * 60_000;
  private static readonly HEAD_BYTES = 12;
  private static readonly PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  private static readonly JPEG = Buffer.from([0xff, 0xd8, 0xff]);

  private readonly downloader: MaterialDownloader;
  /** 받으려 한 사진 (receive). 사진이 없거나 칸의 일이면 null */
  private received: RefPhotos | null = null;

  constructor(
    private readonly job: Job,
    server: CairnServer,
    serverUrl: string,
    /** 이 엔진이 사진을 보는 법. null이면 보지 못한다: 받지 않고 모두 받지 못한 사진으로 적는다 */
    private readonly sight: PhotoSight | null,
  ) {
    this.downloader = new MaterialDownloader(server, serverUrl, JobPhotos.MAX_BYTES);
  }

  /** 참조의 사진을 photos/에 받는다. 멈추면(signal) 그 자리에서 그만둔다 */
  async receive(
    workspace: JobWorkspace,
    signal: AbortSignal,
    note: (event: RunEvent) => void,
  ): Promise<void> {
    const photos = this.job.sandboxed ? new Map<string, string>() : this.job.refs.photos;
    if (photos.size === 0) return;
    const { workDir } = workspace;
    const files = new Map<string, string>();
    if (this.sight === null)
      note(new RunEvent(RunEvent.ERROR, '이 AI 도구는 사진을 보지 못해요', 0));
    else {
      await mkdir(join(workDir, JobPhotos.FOLDER), { mode: 0o700 });
      note(new RunEvent(RunEvent.READ, `사진 ${photos.size}장을 받아요`, 0));
      const until = AbortSignal.any([signal, AbortSignal.timeout(JobPhotos.RECEIVE_MS)]);
      for (const [n, [id, title]] of [...photos].entries()) {
        try {
          files.set(id, await this.one(id, `photo-${n + 1}`, workDir, until));
        } catch (error) {
          if (signal.aborted) return;
          const why = until.aborted ? '시간 안에 받지 못했어요' : (error as Error).message;
          note(new RunEvent(RunEvent.ERROR, `사진을 받지 못했어요 (${title}): ${why}`, 0));
        }
      }
      note(new RunEvent(RunEvent.RESULT, `사진 ${files.size}장을 받았어요`, 0));
    }
    this.received = new RefPhotos(this.sight === 'attach', workDir, files);
  }

  /** 받은 사진을 실은 같은 일 (지시문의 사진 줄 · 지시에 붙일 파일). 받으려 한 사진이 없으면 그대로 */
  onto(job: Job): Job {
    return this.received === null ? job : job.withPhotos(this.received);
  }

  /** 사진 하나를 받아 형식을 보고 확장자를 붙인다. 작업 폴더 안의 경로 */
  private async one(id: string, name: string, workDir: string, signal: AbortSignal) {
    const dir = join(workDir, JobPhotos.FOLDER);
    const got = await this.downloader.download(this.job.taskId, id, dir, signal, name);
    const path = join(dir, got.name);
    const format = JobPhotos.formatOf(await JobPhotos.head(path));
    if (format === null) {
      await rm(path, { force: true });
      throw new Error('PNG · JPEG · GIF · WebP가 아니에요');
    }
    const file = join(JobPhotos.FOLDER, `${got.name}.${format}`);
    await rename(path, join(workDir, file));
    return file;
  }

  /** 앞부분의 표시로 본 형식의 확장자 (서버의 FileSniff와 같은 표시). 사진이 아니면 null */
  static formatOf(head: Buffer): string | null {
    if (head.subarray(0, 8).equals(JobPhotos.PNG)) return 'png';
    if (head.subarray(0, 3).equals(JobPhotos.JPEG)) return 'jpg';
    const text = head.toString('latin1');
    if (text.startsWith('GIF87a') || text.startsWith('GIF89a')) return 'gif';
    if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'webp';
    return null;
  }

  private static async head(path: string): Promise<Buffer> {
    const handle = await open(path, 'r');
    try {
      const { buffer, bytesRead } = await handle.read(
        Buffer.alloc(JobPhotos.HEAD_BYTES),
        0,
        JobPhotos.HEAD_BYTES,
        0,
      );
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }
}
