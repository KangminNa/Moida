import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { ToolTaskInput } from './external-tool.input';
import { ExternalToolCheckService } from './external-tool-check.service';

// 끝난 작업마다 (task.task.changed): 커넥터 확인의 결과 · 에이전트의 일의 커넥터 사용을 커넥터에 적는다 (2026-11-15 MCP 1단계).
// 대기 · 실행 · 기다림으로 바뀐 것은 넘어간다. 두 번 받아도 같다
@Injectable()
export class ExternalToolTaskHandler extends BaseHandler {
  constructor(private readonly checks: ExternalToolCheckService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (!ToolTaskInput.carriedBy(event.data)) return;
    await this.checks.noteTask(new SystemActor(), event.spaceId, ToolTaskInput.from(event.data));
  }
}
