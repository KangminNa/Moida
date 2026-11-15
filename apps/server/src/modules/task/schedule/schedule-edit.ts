import { Actor, RuleViolation, type Sql } from '../../platform';
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
  constructor(
    private readonly tx: Sql,
    private readonly spaceId: string,
  ) {}

  /** 새 스케줄 (아직 저장 전) */
  async open(req: CreateScheduleInput, now: Date): Promise<Schedule> {
    await this.assertRefs(req.settings);
    return Schedule.open(this.spaceId, req.settings, now);
  }

  async update(req: UpdateScheduleInput, now: Date): Promise<Schedule> {
    const schedule = await new ScheduleRepository(this.tx).lock(this.spaceId, req.id);
    schedule.assertVersion(req.version);
    await this.assertRefs(req.settings, schedule.id);
    schedule.configure(req.settings, now);
    return schedule;
  }

  /**
   * 설정 바꾸기 하나 (2026-11-15 C): 제안의 미리 해 보기와 승인 뒤 적용이 같은 줄.
   * body는 관리자 REST(POST · PATCH api/schedules)와 같은 본문 (고치기는 설정 전부), key는 만들기의 requestId (결재 id)
   */
  apply(op: string, id: string, version: number, body: object, key: string, now: Date) {
    if (op === 'create')
      return this.open(CreateScheduleInput.from({ ...body, requestId: key }), now);
    return this.update(UpdateScheduleInput.from(id, { ...body, version }), now);
  }

  private async assertRefs(settings: Partial<ScheduleRow>, self: string | null = null) {
    const agent = settings.agent_id
      ? await new AgentRepository(this.tx).load(this.spaceId, settings.agent_id)
      : null;
    if (settings.page_id && agent && !agent.scopes.includes(Actor.MAKE))
      throw new RuleViolation('페이지의 새 버전은 만들기(make) 권한이 있는 에이전트가 맡아요');
    if (settings.destination === Schedule.CHAT && agent && !agent.topLevel)
      throw new RuleViolation(
        `대화는 관리자 바로 아래 에이전트와만 해요: ${agent.name}은(는) 팀원이에요`,
      );
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
