import { Injectable } from '@nestjs/common';
import {
  Actor,
  Database,
  EntityService,
  Idempotency,
  NoticeKind,
  Notices,
  RuleViolation,
  SettingActor,
  type SettingChangeInput,
  SettingOutcome,
  type Sql,
  type VersionInput,
} from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { AgentEdit } from '../agent/agent-edit';
import type { AgentUsage } from '../agent/agent-usage';
import { Chat } from '../chat/chat';
import { ChatRepository } from '../chat/chat.repository';
import { ChatHistory } from '../chat/chat-history.policy';
import { GoalRepository } from '../goal/goal.repository';
import { SettingChanges } from '../setting-change/setting-change.policy';
import type { PromptTemplates } from '../skill/prompt-templates';
import { SkillQuery } from '../skill/skill.query';
import type { Task } from '../task/task';
import { TaskRepository } from '../task/task.repository';
import type { ScheduleRow } from '../task.tables';
import { TaskNotices } from '../task-notices';
import { Schedule } from './schedule';
import type { CreateScheduleInput, UpdateScheduleInput } from './schedule.input';
import { ScheduleRepository } from './schedule.repository';
import { ScheduleEdit } from './schedule-edit';

// 스케줄(자동화 레시피) 쓰기: 주인이 만들고 · 고치고 · 지우고 · 지금 한 번 돌리고, 일꾼이 1분마다 때가 된 것을 돌린다.
// 한 번 돌리기는 어디로에 따라 작업 하나(task) · 페이지 만들기 일 하나(page) · 대표의 대화 회차 하나(chat, 처음이면 대화를 연다, O-2).
// 작업은 request_id(schedule:<스케줄>:<시각>)로, 회차는 그 요청(payload.chat.requestId)으로 한 번만 생긴다.
// 지시와 지킬 것은 지시문 틀 recipe로 묶는다. 앞 레시피의 일이 끝나면 그 뒤의 레시피가 돈다 (follow, ScheduleFollowHandler).
@Injectable()
export class ScheduleService extends EntityService<Schedule> {
  /** 한 번에 돌리는 수. 남은 것은 다음 차례에 */
  private static readonly BATCH = 50;
  private static readonly CREATE = 'schedule.create';
  private static readonly FOLLOW = 'schedule.follow';

  constructor(
    db: Database,
    private readonly skills: SkillQuery,
  ) {
    super(db);
  }

  protected store(tx: Sql): ScheduleRepository {
    return new ScheduleRepository(tx);
  }

  async create(actor: Actor, req: CreateScheduleInput): Promise<Schedule> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const now = new Date();
    return this.transaction(async (tx) => {
      const schedules = new ScheduleRepository(tx);
      const once = new Idempotency(tx, actor.id ?? spaceId, req.requestId, ScheduleService.CREATE);
      const before = await once.previous();
      if (before) return schedules.load(spaceId, String(before.scheduleId));
      const schedule = await new ScheduleEdit(tx, spaceId).open(req, now);
      await schedules.save(schedule);
      await once.remember({ scheduleId: schedule.id });
      return schedule;
    });
  }

  async update(actor: Actor, req: UpdateScheduleInput): Promise<Schedule> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const schedule = await new ScheduleEdit(tx, spaceId).update(req, new Date());
      await new ScheduleRepository(tx).save(schedule);
      return schedule;
    });
  }

  /** 설정 바꾸기 제안의 미리 해 보기 (2026-11-15 C · D): 관리자의 고치기와 같은 줄(ScheduleEdit)을 지나고 저장하지 않는다 */
  async rehearseSetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingActor.spaceOf(actor);
    await this.transaction(async (tx) => {
      await new ScheduleEdit(tx, spaceId).apply(change, new Date());
    });
  }

  /**
   * 승인한 설정 바꾸기 (2026-11-15 C, SettingApplyHandler): 관리자의 고치기와 같은 줄(ScheduleEdit).
   * 결재마다 한 번만 적용하고 결과(task.setting.changed)를 남긴다. 승인한 뒤 바뀌었으면 실패로 끝난다
   */
  async applySetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingOutcome.spaceOf(actor, change.key);
    await SettingOutcome.settle(
      (work) => this.transaction(work),
      SettingChanges.TOPIC,
      spaceId,
      change.key,
      async (tx) => {
        const schedule = await new ScheduleEdit(tx, spaceId).apply(change, new Date());
        await new ScheduleRepository(tx).save(schedule);
      },
    );
  }

  async remove(actor: Actor, req: VersionInput): Promise<void> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    await this.transaction(async (tx) => {
      const schedules = new ScheduleRepository(tx);
      const schedule = await schedules.lock(spaceId, req.id);
      schedule.assertVersion(req.version);
      await schedules.remove(schedule);
    });
  }

  /**
   * 주인이 누른 "지금 한 번": 하루 한도에 함께 센다. 앞 작업이 안 끝났어도 만든다 (사람이 고른 것이라).
   * 같은 순간을 두 번 누르면 시각이 달라 작업 둘이 된다 (version이 막는다)
   */
  async runNow(actor: Actor, req: VersionInput): Promise<Task> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const prompts = await this.skills.prompts(actor, spaceId);
    const now = new Date();
    return this.transaction(async (tx) => {
      const schedules = new ScheduleRepository(tx);
      const schedule = await schedules.lock(spaceId, req.id);
      schedule.assertVersion(req.version);
      const slot = schedule.runNow(now);
      await schedules.save(schedule);
      const task = await this.start(tx, schedule, slot, prompts, now);
      if (!task) throw new RuleViolation('이번 차례의 일이 이미 있어요');
      return task;
    });
  }

  /**
   * 때가 된 스케줄을 돌린다 (일꾼이 1분마다). 다음 시각으로 넘기고, 일을 만들 수 있을 때만 만든다.
   * 만들지 않는 때: 담당이 멈췄거나 한도로 쉼, 앞 일(작업 · 대화 회차)이 아직 끝나지 않음, 가리키는 페이지를 고치는
   * 다른 일이 돎, 하루 한도에 닿음. 만든 작업 수를 돌려준다
   */
  async runDue(actor: Actor): Promise<number> {
    actor.assertOwnerOrSystem();
    const now = new Date();
    return this.transaction(async (tx) => {
      const schedules = new ScheduleRepository(tx);
      const due = await schedules.lockDue(now, ScheduleService.BATCH);
      const usage = new Map<string, readonly AgentUsage[]>();
      const prompts = new Map<string, PromptTemplates>();
      let made = 0;
      for (const schedule of due) {
        const slot = schedule.fire(now);
        if (!(await this.ready(tx, schedule, usage, now)) || (await this.busy(tx, schedule))) {
          await schedules.save(schedule);
          continue;
        }
        const allowed = schedule.claimRun(now);
        await schedules.save(schedule);
        if (!allowed) {
          await new Notices(tx).post(ScheduleService.skippedNotice(schedule));
          continue;
        }
        const { spaceId } = schedule;
        if (!prompts.has(spaceId)) prompts.set(spaceId, await this.skills.prompts(actor, spaceId));
        if (await this.start(tx, schedule, slot, prompts.get(spaceId) as PromptTemplates, now))
          made += 1;
      }
      return made;
    });
  }

  /**
   * 레시피의 일이 끝났다 (계기 after, ScheduleFollowHandler): 그 뒤에 도는 레시피를 돌린다. 끝난 작업 하나에 한 번만
   * (일꾼이 같은 이벤트를 두 번 넘겨도). 담당이 쉬거나 앞 일이 안 끝났거나 하루 한도면 그 레시피는 이번에 건너뛴다
   */
  async follow(actor: Actor, spaceId: string, taskId: string): Promise<number> {
    actor.assertOwnerOrSystem();
    const prompts = await this.skills.prompts(actor, spaceId);
    const now = new Date();
    return this.transaction(async (tx) => {
      const source = Schedule.sourceOf(await new TaskRepository(tx).doneRequestOf(spaceId, taskId));
      if (source === null) return 0;
      const schedules = new ScheduleRepository(tx);
      const next = await schedules.lockAfter(spaceId, source);
      if (next.length === 0) return 0;
      const once = new Idempotency(tx, spaceId, `follow:${taskId}`, ScheduleService.FOLLOW);
      if (await once.previous()) return 0;
      const usage = new Map<string, readonly AgentUsage[]>();
      let made = 0;
      for (const schedule of next) {
        if (!(await this.ready(tx, schedule, usage, now)) || (await this.busy(tx, schedule)))
          continue;
        const slot = schedule.follow(now);
        await schedules.save(schedule);
        if (slot !== null && (await this.start(tx, schedule, slot, prompts, now))) made += 1;
      }
      await once.remember({ made });
      return made;
    });
  }

  /**
   * 레시피 한 번: 어디로에 따라 작업 하나(task · page)나 대표의 대화 회차 하나(chat). 처음 도는 대화 레시피는 대화를 열고
   * 기억한다 (그 대화의 받을 것이 레시피의 받을 것). 만든 작업, 같은 차례의 일이 이미 있으면 null
   */
  private async start(
    tx: Sql,
    schedule: Schedule,
    slot: Date,
    prompts: PromptTemplates,
    now: Date,
  ): Promise<Task | null> {
    const instruction = prompts.fill('recipe', {
      instruction: schedule.taskInstruction,
      rules: schedule.rules.trim(),
    });
    const tasks = new TaskRepository(tx);
    if (schedule.destination !== Schedule.CHAT) {
      const task = schedule.wake(slot, await this.goalOf(tx, schedule), instruction, now);
      return (await tasks.insertOnce(task)) ? task : null;
    }
    const { spaceId, chatId } = schedule;
    const lead = await new AgentEdit(tx, spaceId).lead(now);
    const chats = new ChatRepository(tx);
    const requestId = schedule.requestIdFor(slot);
    if (chatId === null) {
      const chat = Chat.open(spaceId, requestId, instruction, now, { deliver: schedule.deliver });
      const turn = chat.assign(lead, now);
      await chats.save(chat);
      schedule.openedChat(chat.id);
      await new ScheduleRepository(tx).save(schedule);
      return (await tasks.insertOnce(turn)) ? turn : null;
    }
    const chat = await chats.lock(spaceId, chatId);
    const previous = await chats.previousTurns(chat, spaceId);
    if (ChatHistory.sentAs(previous.at(-1), requestId)) return null;
    const turn = chat.send(lead, requestId, instruction, previous, now);
    await chats.save(chat);
    return (await tasks.insertOnce(turn)) ? turn : null;
  }

  /**
   * 담당이 일을 받을 수 있는가 (멈춤 · 한도로 쉼이면 아니다). 담당이 없으면 늘 그렇다 (빌릴 때 자동 배정).
   * 대화로 보내는 레시피는 대표가 맡는다 (O-2): 대표가 아직 없으면 처음 열 때 만든다
   */
  private async ready(
    tx: Sql,
    schedule: Schedule,
    usage: Map<string, readonly AgentUsage[]>,
    now: Date,
  ): Promise<boolean> {
    const { agentId, spaceId } = schedule;
    const chat = schedule.destination === Schedule.CHAT;
    if (agentId === null && !chat) return true;
    if (!usage.has(spaceId)) usage.set(spaceId, await new AgentRepository(tx).usage(spaceId, now));
    const who = usage.get(spaceId)?.find((u) => (chat ? u.agent.lead : u.agent.id === agentId));
    return chat && !who ? true : who?.ready === true;
  }

  /** 앞 일이 아직 끝나지 않았는가: 이 레시피의 작업 · 가리키는 페이지를 고치는 일 · 대화의 마지막 회차 */
  private async busy(tx: Sql, schedule: Schedule): Promise<boolean> {
    const tasks = new TaskRepository(tx);
    const { spaceId, pageId, chatId } = schedule;
    if (await tasks.hasOpenRequest(spaceId, schedule.requestPrefix)) return true;
    if (pageId !== null && (await tasks.hasOpenPage(spaceId, pageId))) return true;
    if (chatId === null) return false;
    const chats = new ChatRepository(tx);
    const chat = await chats.lock(spaceId, chatId);
    return ChatHistory.waiting((await chats.previousTurns(chat, spaceId)).at(-1));
  }

  /** 하루 한도로 건너뛴 기록 (기록만). 스케줄마다 한 줄이라 읽기 전까지 쌓이지 않는다 */
  private static skippedNotice(schedule: Schedule) {
    return {
      space_id: schedule.spaceId,
      kind: TaskNotices.SCHEDULE_SKIPPED,
      severity: NoticeKind.LOG,
      title: `${schedule.title}: 오늘 한도(${schedule.dailyMax}번)에 닿아 건너뛰었어요`,
      body: null,
      link: '/admin/schedules',
      group_key: `schedule-skipped:${schedule.id}`,
      data: { scheduleId: schedule.id },
    };
  }

  /**
   * 담당 에이전트 · 목표 · 앞 레시피가 이 공간에 있는가. 목표는 진행 중이어야 한다.
   * 페이지로 보내면 담당이 만들기(make) 권한을 가져야 하고(담당이 없으면 make 에이전트가 자동으로 맡는다),
   * 대화로 보내면 담당이 관리자 바로 아래 에이전트여야 한다. 앞 레시피를 거슬러 올라가 자기가 나오면 고리라 막는다
   */
  /** 작업이 향할 목표. 닫혔으면 wake가 목표 없이 만든다 */
  private goalOf(tx: Sql, schedule: Schedule) {
    return schedule.goalId === null
      ? Promise.resolve(null)
      : new GoalRepository(tx).load(schedule.spaceId, schedule.goalId);
  }
}
