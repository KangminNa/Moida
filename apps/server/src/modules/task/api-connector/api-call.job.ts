import { Injectable } from '@nestjs/common';
import { BaseDueJob, SystemActor } from '../../platform';
import { OutputService } from '../output/output.service';
import { ApiCall } from './api-call';
import { ApiCallGateway } from './api-call.gateway';
import { ApiCallService } from './api-call.service';

// API 부르기의 뒷일 (2026-11-24, 마감 작업): 때가 된 상태 묻기를 하고(ApiCallService.due), 끝난 답의 파일을 받아
// 부른 작업의 실행에 결과물로 남긴다 (OutputService.keepFetched). 파일은 키 없이 받는다 (ApiCallGateway.download).
// 저장(next_at)이 깨우고, 맡은 부르기는 다음 차례를 미뤄 두 번 받지 않는다 (ApiCall.claim). 두 번 불려도 결과가 같다
@Injectable()
export class ApiCallJob extends BaseDueJob {
  readonly name = ApiCall.JOB;
  /** 파일 이름의 확장자 (서비스가 알린 형식으로) */
  private static readonly EXT: Readonly<Record<string, string>> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'application/pdf': 'pdf',
  };

  constructor(
    private readonly calls: ApiCallService,
    private readonly outputs: OutputService,
    private readonly gateway: ApiCallGateway,
  ) {
    super();
  }

  async run(now: Date): Promise<Date | null> {
    const actor = new SystemActor();
    for (const call of await this.calls.due(actor, now)) {
      const made = call.taskId && call.runId ? { taskId: call.taskId, runId: call.runId } : null;
      const ids: string[] = [];
      const errors: string[] = [];
      for (const [i, url] of call.fileUrls.entries()) {
        try {
          const output = await this.gateway.download(url, (body, type) =>
            this.outputs.keepFetched(
              actor,
              call.spaceId,
              made,
              ApiCallJob.nameOf(call, i, url, type),
              body,
            ),
          );
          ids.push(output.id);
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
      await this.calls.filesKept(actor, call, ids, errors);
    }
    return this.calls.nextDue(actor);
  }

  /** <동작>-<부르기 앞 8자>-<번호>.<확장자>: 같은 실행 안에서 겹치지 않게 */
  private static nameOf(call: ApiCall, i: number, url: string, type: string | null): string {
    const mime = (type ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    const fromUrl = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
    const ext = ApiCallJob.EXT[mime] ?? fromUrl ?? 'bin';
    return `${call.operation}-${call.id.slice(-8)}-${i + 1}.${ext}`;
  }
}
