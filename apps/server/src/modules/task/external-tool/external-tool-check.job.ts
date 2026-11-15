import { Injectable } from '@nestjs/common';
import { BaseDueJob, SystemActor } from '../../platform';
import { ExternalTool } from './external-tool';
import { ExternalToolCheckService } from './external-tool-check.service';

// 확인할 때가 된 켜진 커넥터에 확인을 맡긴다 (2026-11-15 MCP 1단계): 처음 켰을 때 · 주소 · 토큰을 고친 뒤 · 하루 지났을 때.
// 확인 자체는 러너가 한다 (tool_check).
// 마감 작업 (리팩토링 2단계): 가장 이른 다시 확인 시각에 깬다. 커넥터를 켜거나 고치면 저장이 깨우고(ExternalToolRepository.dueWake),
// 확인 작업이 끝나면(task.task.changed) 다시 잰다
@Injectable()
export class ExternalToolCheckJob extends BaseDueJob {
  readonly name = ExternalTool.CHECK_JOB;

  constructor(private readonly checks: ExternalToolCheckService) {
    super();
  }

  run(): Promise<Date | null> {
    return this.checks.checkDue(new SystemActor(), new Date());
  }
}
