import {
  Actor,
  type CodeMail,
  RuleViolation,
  type SettingChangeInput,
  type SettingShape,
  type Sql,
  type Unchecked,
} from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { GoalRepository } from '../goal/goal.repository';
import type { ScheduleRow } from '../task.tables';
import { Schedule } from './schedule';
import { CreateScheduleInput, UpdateScheduleInput } from './schedule.input';
import { ScheduleRepository } from './schedule.repository';

/**
 * 스케줄(레시피) 만들기 · 고치기 한 번을 부르는 쪽의 트랜잭션에서 (2026-11-15 C).
 * 관리자의 고치기(ScheduleService), 설정 바꾸기 제안의 미리 해 보기, 승인 뒤 적용이 같은 줄을 지난다.
 * 가리키는 담당 · 목표 · 앞 레시피를 확인하고 엔티티 메서드를 부른다. 저장은 부르는 쪽이 정한다
 */
export class ScheduleEdit {
  /** 대화로 바꾸는 스케줄(레시피) (get_settings schedules · propose_setting schedule, 2026-11-15 C) */
  static readonly SETTING: SettingShape = {
    setting: 'schedule',
    list: 'schedules',
    ops: ['create', 'edit'],
    fields: [
      'title',
      'agent_id',
      'enabled',
      'mode',
      'at_time',
      'weekdays',
      'every_hours',
      'every_minutes',
      'time_zone',
      'instruction',
      'goal_id',
      'page_id',
      'destination',
      'deliver',
      'mail',
      'rules',
      'trigger',
      'after_id',
      'daily_max',
    ],
    target: 'id',
    versioned: true,
    grants: [],
  };

  constructor(
    private readonly tx: Sql,
    private readonly spaceId: string,
    /** 메일로 받기를 켤 때 메일을 보낼 수 있는지 본다 (2026-11-27) */
    private readonly mail: CodeMail,
  ) {}

  /** 새 스케줄 (아직 저장 전) */
  async open(req: CreateScheduleInput, now: Date): Promise<Schedule> {
    await this.assertRefs(req.settings);
    if (req.settings.mail) this.mail.assertReady();
    return Schedule.open(this.spaceId, req.settings, now);
  }

  async update(req: UpdateScheduleInput, now: Date): Promise<Schedule> {
    const schedule = await new ScheduleRepository(this.tx).lock(this.spaceId, req.id);
    schedule.assertVersion(req.version);
    await this.assertRefs(req.settings, schedule.id);
    // 새로 켤 때만: 켜 둔 뒤 플러그인을 꺼도 다른 칸은 고칠 수 있게
    if (req.settings.mail && !schedule.mail) this.mail.assertReady();
    schedule.configure(req.settings, now);
    return schedule;
  }

  /**
   * 설정 바꾸기 하나 (2026-11-15 C): 제안의 미리 해 보기와 승인 뒤 적용이 같은 줄.
   * body는 관리자 REST(POST · PATCH api/schedules)와 같은 본문 (고치기는 설정 전부), key는 만들기의 requestId (결재 id)
   */
  apply(change: SettingChangeInput, now: Date): Promise<Schedule> {
    const { body, version } = change;
    if (change.op === 'create')
      return this.open(CreateScheduleInput.from({ ...body, requestId: change.key }), now);
    return this.update(
      UpdateScheduleInput.from(String(change.targetId), { ...body, version }),
      now,
    );
  }

  private async assertRefs(settings: Partial<Unchecked<ScheduleRow>>, self: string | null = null) {
    const agent = settings.agent_id
      ? await new AgentRepository(this.tx).load(this.spaceId, settings.agent_id)
      : null;
    if (settings.page_id && agent && !agent.scopes.includes(Actor.MAKE))
      throw new RuleViolation('페이지의 새 버전은 만들기(make) 권한이 있는 에이전트가 맡아요');
    if (settings.goal_id)
      (await new GoalRepository(this.tx).load(this.spaceId, settings.goal_id)).assertActive();
    if (settings.after_id) {
      const schedules = new ScheduleRepository(this.tx);
      await schedules.load(this.spaceId, settings.after_id);
      if (
        self !== null &&
        (await schedules.chainOf(this.spaceId, settings.after_id)).includes(self)
      )
        throw new RuleViolation('레시피가 서로를 기다리는 고리가 돼요');
    }
  }
}
