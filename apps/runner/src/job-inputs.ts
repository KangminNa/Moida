import type { Job } from './job';
import { JobPhotos, type PhotoSight } from './job-photos';
import type { JobWorkspace } from './job-workspace';
import type { MoidaServer } from './moida-server';
import { RunEvent } from './progress';

// 일에 붙는 입력 받기: 대화에 넣은 사진(JobPhotos)과 앱 화면 공개를 검수하는 일의 코드 (서버 ChatInspect, 2026-11-20).
// 검수할 코드는 러너가 app_code_base로 받아 작업 폴더의 app/에 둔다 (만들기 일의 inputs/app/와 같은 모양, AppCodeBase).
// AI는 파일로 읽는다 (화면을 볼 수 없어 코드로 판단한다). 받지 못하면 실행 기록에 남기고 이어 간다: 지시문 틀이
// 빈 폴더면 통과시키지 말라고 한다. 칸의 일은 받지 않는다 (검수는 칸에서 돌지 않는다)
export class JobInputs {
  private readonly photos: JobPhotos;

  constructor(
    private readonly job: Job,
    private readonly server: MoidaServer,
    serverUrl: string,
    sight: PhotoSight | null,
  ) {
    this.photos = new JobPhotos(job, server, serverUrl, sight);
  }

  /** 사진과 검수할 앱 코드를 작업 폴더에 받는다. 멈추면(signal) 그 자리에서 그만둔다 */
  async receive(
    workspace: JobWorkspace,
    signal: AbortSignal,
    note: (event: RunEvent) => void,
  ): Promise<void> {
    await this.photos.receive(workspace, signal, note);
    if (this.job.chat?.inspectsApp && !this.job.sandboxed && !signal.aborted)
      await this.inspectedCode(workspace, signal, note);
  }

  /** 받은 사진을 실은 같은 일 (JobPhotos.onto) */
  onto(job: Job): Job {
    return this.photos.onto(job);
  }

  private async inspectedCode(
    workspace: JobWorkspace,
    signal: AbortSignal,
    note: (event: RunEvent) => void,
  ): Promise<void> {
    try {
      const base = await this.server.appCodeBase(this.job.taskId, signal);
      if (base === null) throw new Error('검수할 앱이 없어요');
      await base.writeTo(workspace.workDir);
      const count = base.files.filter((f) => f.text !== null).length;
      note(new RunEvent(RunEvent.READ, `검수할 앱 코드 ${count}개 파일을 받았어요`, 0));
    } catch (error) {
      if (signal.aborted) return;
      const why = (error as Error).message;
      note(new RunEvent(RunEvent.ERROR, `검수할 앱 코드를 받지 못했어요: ${why}`, 0));
    }
  }
}
