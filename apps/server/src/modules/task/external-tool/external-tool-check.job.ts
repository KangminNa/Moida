import { Injectable } from '@nestjs/common';
import { BaseJob, SystemActor } from '../../platform';
import { ExternalToolCheckService } from './external-tool-check.service';

// 확인할 때가 된 켜진 커넥터에 확인을 맡긴다 (2026-11-15 MCP 1단계): 처음 켰을 때 · 주소 · 토큰을 고친 뒤 · 하루 지났을 때.
// 확인 자체는 러너가 한다 (tool_check)
@Injectable()
export class ExternalToolCheckJob extends BaseJob {
  static readonly EVERY_MS = 2 * 60 * 1000;
  readonly name = 'task.external_tools.check';

  constructor(private readonly checks: ExternalToolCheckService) {
    super();
  }

  async run(): Promise<void> {
    await this.checks.checkDue(new SystemActor(), new Date());
  }
}
