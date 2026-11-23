import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { type Actor, CurrentActor, VersionInput } from '../../platform';
import { CreateTaskInput, ListTasksInput, TaskIdInput, TaskTrashInput } from './task.input';
import { TaskQuery } from './task.query';
import { TaskService } from './task.service';
import type { TaskDetailView, TaskPageView, TaskTrashedView, TaskView } from './task.view';
import { TaskTrashService } from './task-trash.service';

// 작업 메뉴. 주인만 (Service·Query 첫 줄에서 확인).
// 바꾼 작업은 목록의 한 줄과 같은 모양이고, 화면은 그 version으로 다음 변경을 보낸다.
@Controller('api/tasks')
export class TaskController {
  constructor(
    private readonly tasks: TaskQuery,
    private readonly service: TaskService,
    private readonly trashes: TaskTrashService,
  ) {}

  /** 작업 기록의 휴지통으로 { ids } 또는 { finished: true }(끝난 작업 모두). 도는 작업은 넘어간다 (2026-11-23) */
  @HttpCode(200)
  @Post('trash')
  trash(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<TaskTrashedView> {
    return this.trashes.trash(actor, TaskTrashInput.from(body));
  }

  /** 휴지통에서 꺼낸다 { ids } */
  @HttpCode(200)
  @Post('restore')
  restore(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<TaskTrashedView> {
    return this.trashes.restore(actor, TaskTrashInput.from(body, false));
  }

  /** ?status=running · ?trash=1(휴지통) · ?cursor=<앞 응답의 next> */
  @Get()
  list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<TaskPageView> {
    return this.tasks.list(actor, ListTasksInput.from(query));
  }

  /** 작업 하나 + 실행 기록 */
  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<TaskDetailView> {
    return this.tasks.get(actor, TaskIdInput.from(id));
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<TaskView> {
    return (await this.service.create(actor, CreateTaskInput.from(body))).view();
  }

  /** 지금까지의 결과로 답하기 (팀원 기다리기): 하위 작업을 기다리는 작업을 바로 깨운다 */
  @HttpCode(200)
  @Post(':id/hurry')
  async hurry(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<TaskView> {
    return (await this.service.hurry(actor, TaskIdInput.from(id))).view();
  }

  /** 판단 바꾸기 (L1): 팀원을 기다리는 회차를 바로 깨운다 (재촉과 달리 다시 맡길 수 있다) */
  @HttpCode(200)
  @Post(':id/wake')
  async wake(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<TaskView> {
    return (await this.service.wake(actor, TaskIdInput.from(id))).view();
  }

  @HttpCode(200)
  @Post(':id/cancel')
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<TaskView> {
    return (await this.service.cancel(actor, VersionInput.from(id, body))).view();
  }
}
