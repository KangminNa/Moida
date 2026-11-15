import { Injectable } from '@nestjs/common';
import { type Actor, BaseService, Database, type Sql } from '../../platform';
import { Task } from '../task/task';
import { TaskRepository } from '../task/task.repository';
import { ExternalTool } from './external-tool';
import type { CheckExternalToolInput, ToolTaskInput } from './external-tool.input';
import { ExternalToolQuery } from './external-tool.query';
import { ExternalToolRepository } from './external-tool.repository';
import { ToolCatalog } from './tool-catalog.policy';

// 커넥터의 연결 확인과 사용 기록 (2026-11-15 MCP 1단계, docs/MCP.md). 서버는 원격 MCP에 붙지 않는다 (SSRF):
// 확인은 러너의 일(tool_check)로 맡기고, 끝나면 결과(도구 목록 · 실패 까닭)를 커넥터에 적는다 (ExternalToolTaskHandler).
// 같은 모듈의 여러 묶음 (객체설계 4장): 확인 일(작업)을 만들며 도구를 읽는다. 잠그는 순서는 작업 → 외부 도구
@Injectable()
export class ExternalToolCheckService extends BaseService {
  /** 한 번에 확인을 맡기는 도구 수 (남은 것은 다음 차례에) */
  private static readonly BATCH = 20;

  constructor(
    db: Database,
    private readonly tools: ExternalToolQuery,
  ) {
    super(db);
  }

  /** 관리자의 "연결 확인". 이미 기다리는 확인이 있으면 그 일을 돌려준다 */
  async check(actor: Actor, req: CheckExternalToolInput): Promise<Task> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const tool = await new ExternalToolRepository(tx).load(spaceId, req.id);
      return this.enqueue(tx, tool, new Date());
    });
  }

  /**
   * 확인할 때가 된 켜진 도구(처음 · 고친 뒤 · 하루 지남)마다 확인을 맡긴다 (ExternalToolCheckJob).
   * 다음에 다시 볼 때를 돌려준다 (한 묶음을 꽉 채웠으면 지금)
   */
  async checkDue(actor: Actor, now: Date): Promise<Date | null> {
    actor.assertOwnerOrSystem();
    return this.transaction(async (tx) => {
      const tools = new ExternalToolRepository(tx);
      const due = await tools.due(now, ExternalToolCheckService.BATCH);
      for (const tool of due) await this.enqueue(tx, tool, now);
      return due.length === ExternalToolCheckService.BATCH ? now : tools.nextCheck();
    });
  }

  /**
   * 끝난 작업 하나 (task.task.changed). 커넥터 확인이면 결과를, 에이전트의 일이면 결과에 실린 커넥터 사용을 적는다.
   * 사용은 그 에이전트가 허락받은 이름만. 두 번 받아도 같다 (시각을 앞으로만 민다)
   */
  async noteTask(actor: Actor, spaceId: string, req: ToolTaskInput): Promise<void> {
    const done = await this.tools.finished(actor, spaceId, req.taskId);
    if (!done) return;
    const at = done.finished_at ?? new Date();
    await this.transaction(async (tx) => {
      const tools = new ExternalToolRepository(tx);
      if (done.kind === Task.TOOL_CHECK) {
        const toolId = (done.payload as { toolId?: unknown } | null)?.toolId;
        if (typeof toolId !== 'string') return;
        const { catalog, error } = ToolCatalog.checked(done.status === Task.DONE, done.result);
        await tools.noteCheck(spaceId, toolId, catalog, error, at);
        await tools.announce(ExternalTool.noted(spaceId, { toolId }));
        return;
      }
      const calls = ToolCatalog.usage(done.result).filter((c) =>
        done.external_tools.includes(c.name),
      );
      if (calls.length === 0) return;
      await tools.noteUsage(spaceId, calls, at);
      await tools.announce(ExternalTool.noted(spaceId, { names: calls.map((c) => c.name) }));
    });
  }

  private async enqueue(tx: Sql, tool: ExternalTool, now: Date): Promise<Task> {
    const tasks = new TaskRepository(tx);
    const pending = await tasks.findPendingToolCheck(tool.spaceId, tool.id);
    if (pending) return pending;
    const task = tool.checkTask(now);
    await tasks.save(task);
    return task;
  }
}
