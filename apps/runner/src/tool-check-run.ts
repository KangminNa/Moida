import type { CairnServer } from './cairn-server';
import type { Job } from './job';
import { McpProbe, ProbeFailed } from './mcp-probe';
import { RunResult } from './progress';
import type { Redactor, RunLog } from './redactor';

/**
 * 커넥터 확인 일 하나 (tool_check, 2026-11-15 MCP 1단계, docs/MCP.md). AI 없이 러너가 원격 MCP에 붙어 도구 목록을 받고
 * submit_result의 result.tools로 보낸다. 실패면 까닭만 (토큰 · 응답 본문은 싣지 않는다). 서버가 그 도구에 적는다
 */
export class ToolCheckRun {
  constructor(
    private readonly job: Job,
    private readonly server: Pick<CairnServer, 'submit'>,
    private readonly redactor: Redactor,
    private readonly log: RunLog,
    private readonly signal: AbortSignal,
    private readonly probe: McpProbe = new McpProbe(),
  ) {}

  async perform(): Promise<void> {
    const redactor = this.job.runtime.secrets.reduce((r, s) => r.with(s), this.redactor);
    const tool = this.job.runtime.tools[0];
    let result: RunResult;
    if (!tool) result = RunResult.failed('확인할 커넥터가 없어요', redactor);
    else
      try {
        const tools = await this.probe.tools(tool, this.signal);
        result = RunResult.done(`도구 ${tools.length}개`, redactor).with({ tools });
      } catch (error) {
        const why = error instanceof ProbeFailed ? error.message : '확인하지 못했어요';
        result = RunResult.failed(why, redactor);
      }
    this.log.info(redactor.clean(`${this.job.taskId}: 커넥터 확인 ${result.status}`));
    await this.server.submit(this.job.taskId, result);
  }
}
