import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { AppCodeBaseInput, DeployCodeInput } from './app-code.input';
import { AppCodeQuery } from './app-code.query';
import type { AppCodeBaseView, AppCodeDeployView } from './app-code.view';

// MCP 도구 app_code_base (스토어 1-6): 러너가 쥔 만들기 일이 고칠 앱의 지금 코드(가장 새 버전, 없으면 시작 코드)를 받는다.
// AI는 바꿀 파일만 다시 낸다 (내지 않은 파일은 앞 버전 그대로). run 권한 · 쥔 일만
@Injectable()
export class AppCodeBaseTool extends BaseTool {
  readonly name = 'app_code_base';
  readonly scope = Actor.RUN;
  readonly readOnly = true;
  override readonly idempotent = true;
  readonly inputSchema = {
    properties: { task_id: { type: 'string', format: 'uuid' } },
    required: ['task_id'],
  };

  constructor(private readonly code: AppCodeQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<AppCodeBaseView> {
    return this.code.base(actor, AppCodeBaseInput.from(raw));
  }
}

// MCP 도구 app_code_upload (앱 플랫폼, 스토어 12.5): 이 컴퓨터에서 빌드한 묶음(zip)을 올릴 표를 받는다.
// cairn app deploy가 부른다 (배포 기기 · write). 묶음은 받은 표로 PUT한다 (기기 토큰은 /mcp에서만 요청자다)
@Injectable()
export class AppCodeUploadTool extends BaseTool {
  readonly name = 'app_code_upload';
  readonly scope = Actor.WRITE;
  readonly readOnly = false;
  readonly inputSchema = {
    properties: {
      app: { type: 'string' },
      size: { type: 'integer' },
      sha256: { type: 'string' },
      note: { type: 'string' },
    },
    required: ['app', 'size', 'sha256'],
  };

  constructor(private readonly code: AppCodeQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<AppCodeDeployView> {
    return this.code.deployTicket(actor, DeployCodeInput.from(raw), new Date());
  }
}
