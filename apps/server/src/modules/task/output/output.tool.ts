import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { OUTPUT_KIND } from '../task.tables';
import {
  BeginDownloadInput,
  BeginUploadInput,
  ListOutputsInput,
  OutputReadInput,
} from './output.input';
import { OutputPolicy } from './output.policy';
import { OutputQuery } from './output.query';
import { OutputService } from './output.service';
import type {
  DownloadTicketView,
  OutputReadView,
  OutputToolPageView,
  UploadTicketView,
} from './output.view';

/** 러너가 결과물 하나를 올리기 전에 받는 표. 본문은 이 표로 PUT api/outputs/upload에 보낸다 (MCP로 보내지 않는다) */
@Injectable()
export class BeginUploadTool extends BaseTool {
  readonly name = 'begin_upload';
  readonly scope = Actor.RUN;
  readonly readOnly = false;
  readonly inputSchema = {
    properties: {
      task_id: { type: 'string', format: 'uuid' },
      name: {
        type: 'string',
        maxLength: OutputPolicy.NAME_MAX,
      },
      size: { type: 'integer', minimum: 1, maximum: OutputPolicy.FILE_MAX },
      sha256: {
        type: 'string',
        pattern: '^[0-9a-f]{64}$',
      },
    },
    required: ['task_id', 'name', 'size', 'sha256'],
  };

  constructor(private readonly outputs: OutputService) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<UploadTicketView> {
    return this.outputs.beginUpload(actor, BeginUploadInput.from(raw));
  }
}

/** 러너가 만들기 작업의 재료 결과물 하나를 받기 전에 받는 표. 본문은 이 표로 GET api/outputs/download에서 받는다 */
@Injectable()
export class BeginDownloadTool extends BaseTool {
  readonly name = 'begin_download';
  readonly scope = Actor.RUN;
  readonly readOnly = true;
  readonly inputSchema = {
    properties: {
      task_id: { type: 'string', format: 'uuid' },
      output_id: { type: 'string', format: 'uuid' },
    },
    required: ['task_id', 'output_id'],
  };

  constructor(private readonly outputs: OutputQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<DownloadTicketView> {
    return this.outputs.beginDownload(actor, BeginDownloadInput.from(raw));
  }
}

/** 바깥 AI 도구 · 일꾼이 결과물 목록을 본다 (권한 read_all, 2026-11-27). 내려받기 · 공유 · 지우기는 콘솔에서 */
@Injectable()
export class ListOutputsTool extends BaseTool {
  readonly name = 'list_outputs';
  readonly scope = Actor.READ_ALL;
  readonly readOnly = true;
  override readonly idempotent = true;
  readonly inputSchema = {
    properties: {
      kind: { type: 'string', enum: [...OUTPUT_KIND] },
      task_id: { type: 'string', format: 'uuid' },
      cursor: { type: 'string' },
    },
  };

  constructor(private readonly outputs: OutputQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<OutputToolPageView> {
    return this.outputs.recent(actor, ListOutputsInput.fromTool(raw));
  }
}

/** 결과물 하나. 글자 파일(md · txt · csv · html · json)이면 앞 200KB까지 내용을 함께 */
@Injectable()
export class GetOutputTool extends BaseTool {
  readonly name = 'get_output';
  readonly scope = Actor.READ_ALL;
  readonly readOnly = true;
  override readonly idempotent = true;
  readonly inputSchema = {
    properties: { output_id: { type: 'string', format: 'uuid' } },
    required: ['output_id'],
  };

  constructor(private readonly outputs: OutputQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<OutputReadView> {
    return this.outputs.read(actor, OutputReadInput.from(raw));
  }
}
