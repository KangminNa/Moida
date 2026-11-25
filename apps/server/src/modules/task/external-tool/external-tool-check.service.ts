import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BaseService,
  Conflict,
  Database,
  NoticeKind,
  Notices,
  type Sql,
} from '../../platform';
import { Task } from '../task/task';
import { TaskRepository } from '../task/task.repository';
import { TaskNotices } from '../task-notices';
import { ExternalTool } from './external-tool';
import type {
  ApproveCatalogInput,
  CheckExternalToolInput,
  ToolTaskInput,
} from './external-tool.input';
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
        const approved = catalog === null ? null : await tools.approvedCatalog(spaceId, toolId);
        if (catalog !== null && approved && !ToolCatalog.acceptable(approved.catalog, catalog)) {
          // C3 바뀜 감지: 새 도구 · 설명이 바뀐 도구가 있으면 관리자가 승인할 때까지 일에 붙이지 않는다
          if (await tools.holdCatalog(spaceId, toolId, catalog, at))
            await new Notices(tx).post(
              ExternalToolCheckService.heldNotice(spaceId, toolId, approved.title),
            );
        } else await tools.noteCheck(spaceId, toolId, catalog, error, at);
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

  /**
   * 바뀐 도구 목록 승인 (C3, 관리자만). 화면이 본 바뀐 때와 지금이 다르면(그사이 또 바뀜 · 이미 승인함) 409
   */
  async approveCatalog(actor: Actor, req: ApproveCatalogInput): Promise<void> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    await this.transaction(async (tx) => {
      const tools = new ExternalToolRepository(tx);
      await tools.load(spaceId, req.id);
      if (!(await tools.approveCatalog(spaceId, req.id, req.changedAt)))
        throw new Conflict('그사이 도구 목록이 또 바뀌었거나 이미 승인했어요. 다시 확인해 주세요');
      await tools.announce(ExternalTool.noted(spaceId, { toolId: req.id }));
      await new Notices(tx).settle(spaceId, `connector-changed:${req.id}`, new Date());
    });
  }

  /** 도구가 바뀌어 멈춘 커넥터 (바로 알림) */
  private static heldNotice(spaceId: string, toolId: string, title: string) {
    return {
      space_id: spaceId,
      kind: TaskNotices.CONNECTOR_CHANGED,
      severity: NoticeKind.IMMEDIATE,
      title: `${title}: 도구가 바뀌어 멈췄어요`,
      body: '바뀐 도구 · 설명을 보고 승인하면 다시 써요',
      link: '/admin/external-tools',
      group_key: `connector-changed:${toolId}`,
      data: { toolId },
    };
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
